using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace RadiologyPpt.App;

public sealed class BackendClient
{
    private Process? _currentProcess;
    private Process? _serviceProcess;
    private readonly SemaphoreSlim _serviceStartLock = new(1, 1);
    private readonly SemaphoreSlim _serviceWriteLock = new(1, 1);
    private readonly object _pendingLock = new();
    private readonly Dictionary<string, PendingServiceRequest> _pendingRequests = new(StringComparer.Ordinal);
    private static readonly TimeSpan LongRunningLogDelay = TimeSpan.FromSeconds(12);
    private static readonly TimeSpan LongRunningLogInterval = TimeSpan.FromSeconds(20);

    public BackendClient()
    {
        ProjectRoot = ResolveProjectRoot();
        AppRoot = ProjectRoot;
        ResourceRoot = ProjectRoot;
        CliScript = Path.Combine(ResourceRoot, "src", "cli.mjs");
        ServiceScript = Path.Combine(ResourceRoot, "src", "backend-service.mjs");
        NodePath = ResolveNodePath();
    }

    public string ProjectRoot { get; }
    public string AppRoot { get; }
    public string ResourceRoot { get; }
    public string CliScript { get; }
    public string ServiceScript { get; }
    public string NodePath { get; }

    public string OutputsDir => Path.Combine(AppRoot, "outputs");
    public string StateDir => Path.Combine(AppRoot, "state");
    public string BoardReviewDir => Path.Combine(AppRoot, "library", "board-review");
    public string BoardReviewCorpusPath => Path.Combine(BoardReviewDir, "pdf-corpus.json");

    public async Task<JsonObject> PrepareAsync(IEnumerable<JsonObject> entries, GenerationSettings settings, Action<string> log, CancellationToken cancellationToken)
    {
        var payload = new JsonObject
        {
            ["entries"] = new JsonArray(entries.Select(entry => entry.DeepClone()).ToArray()),
            ["args"] = BuildPrepareArgs(settings)
        };
        return await RunServiceAsync("prepare", payload, log, cancellationToken);
    }

    public async Task<JsonObject?> PrepareSingleAsync(JsonObject request, GenerationSettings settings, Action<string> log, CancellationToken cancellationToken)
    {
        var payload = await PrepareAsync([request], settings, log, cancellationToken);
        var items = payload["items"]?.AsArray();
        return items is { Count: > 0 } ? items[0]?.AsObject() : null;
    }

    public async Task<JsonObject?> ScoreImagesAsync(JsonObject item, GenerationSettings settings, Action<string> log, CancellationToken cancellationToken)
    {
        var payload = new JsonObject
        {
            ["item"] = item.DeepClone(),
            ["args"] = new JsonObject
            {
                ["ollamaModel"] = settings.OllamaModel
            }
        };
        var result = await RunServiceAsync("scoreImages", payload, log, cancellationToken);
        var items = result["items"]?.AsArray();
        return items is { Count: > 0 } ? items[0]?.AsObject() : null;
    }

    public async Task<string> RenderAsync(IEnumerable<JsonObject> approvedItems, GenerationSettings settings, Action<string> log, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(OutputsDir);
        var payload = new JsonObject
        {
            ["items"] = new JsonArray(approvedItems.Select(item => item.DeepClone()).ToArray()),
            ["args"] = new JsonObject
            {
                ["deckMode"] = settings.PowerPointStyle,
                ["theme"] = settings.Theme,
                ["title"] = settings.Title,
                ["out"] = settings.OutputPath,
                ["includeTeachingPoints"] = settings.IncludeTeachingPoints
            }
        };
        var result = await RunServiceAsync("render", payload, log, cancellationToken);
        return $"Created PowerPoint: {TextValue(result, "outputPath")}{Environment.NewLine}Created manifest: {TextValue(result, "manifestPath")}{Environment.NewLine}";
    }

    public async Task ImportCoreReviewPdfsAsync(IEnumerable<string> pdfPaths, string domain, Action<string> log, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(BoardReviewDir);
        var payload = new JsonObject
        {
            ["inputPaths"] = new JsonArray(pdfPaths.Select(path => JsonValue.Create(path)).ToArray()),
            ["args"] = new JsonObject
            {
                ["out"] = BoardReviewCorpusPath,
                ["format"] = "json",
                ["domain"] = domain
            }
        };
        await RunServiceAsync("coreReviewIngestPdf", payload, log, cancellationToken);
    }

    public void CancelCurrentProcess()
    {
        try
        {
            if (_currentProcess is { HasExited: false })
            {
                _currentProcess.Kill(entireProcessTree: true);
            }
        }
        catch
        {
            // Best effort cancellation; the UI will report the backend result.
        }
        try
        {
            if (_serviceProcess is { HasExited: false })
            {
                _serviceProcess.Kill(entireProcessTree: true);
            }
        }
        catch
        {
            // Best effort cancellation; the UI will report the backend result.
        }
    }

    public async Task<string[]> ListOllamaModelsAsync()
    {
        try
        {
            var startInfo = new ProcessStartInfo("ollama", "list")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            using var process = Process.Start(startInfo);
            if (process is null)
            {
                return [];
            }

            var stdout = await process.StandardOutput.ReadToEndAsync();
            await process.WaitForExitAsync();
            return stdout.Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries)
                .Select(line => line.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "")
                .Where(name => !string.IsNullOrWhiteSpace(name) && !name.Equals("NAME", StringComparison.OrdinalIgnoreCase))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }
        catch
        {
            return [];
        }
    }

    private async Task<BackendResult> RunCliAsync(IEnumerable<string> args, Action<string> log, CancellationToken cancellationToken, bool logStdout = true)
    {
        if (!File.Exists(CliScript))
        {
            throw new FileNotFoundException("The backend CLI was not found.", CliScript);
        }

        var startInfo = new ProcessStartInfo(NodePath)
        {
            WorkingDirectory = ProjectRoot,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };
        startInfo.ArgumentList.Add(CliScript);
        foreach (var arg in args)
        {
            startInfo.ArgumentList.Add(arg);
        }

        startInfo.Environment["RADIOLOGY_PPT_APP_ROOT"] = AppRoot;
        startInfo.Environment["RADIOLOGY_PPT_RESOURCE_ROOT"] = ResourceRoot;
        startInfo.Environment["RADIOLOGY_PPT_DATABASE_PATH"] = Path.Combine(StateDir, "radiology-ppt.sqlite");
        startInfo.Environment["NODE_NO_WARNINGS"] = "1";

        using var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        _currentProcess = process;
        var stdout = new StringBuilder();
        var stderr = new StringBuilder();

        process.OutputDataReceived += (_, eventArgs) =>
        {
            if (eventArgs.Data is null)
            {
                return;
            }
            stdout.AppendLine(eventArgs.Data);
            if (logStdout)
            {
                log(eventArgs.Data);
            }
        };
        process.ErrorDataReceived += (_, eventArgs) =>
        {
            if (eventArgs.Data is null)
            {
                return;
            }
            if (TryParseBackendEvent(eventArgs.Data, out var progressMessage))
            {
                log(progressMessage);
                return;
            }
            stderr.AppendLine(eventArgs.Data);
            log(eventArgs.Data);
        };

        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        try
        {
            await process.WaitForExitAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            CancelCurrentProcess();
            throw;
        }
        finally
        {
            if (ReferenceEquals(_currentProcess, process))
            {
                _currentProcess = null;
            }
        }

        return new BackendResult(process.ExitCode, stdout.ToString(), stderr.ToString());
    }

    private static void ThrowIfFailed(BackendResult result, string message)
    {
        if (result.ExitCode == 0)
        {
            return;
        }

        var detail = string.IsNullOrWhiteSpace(result.Stderr) ? result.Stdout : result.Stderr;
        throw new InvalidOperationException($"{message}{Environment.NewLine}{Environment.NewLine}{detail.Trim()}");
    }

    private static async Task<string> WriteTempJsonAsync(JsonNode node, string label, CancellationToken cancellationToken)
    {
        var tempPath = Path.Combine(Path.GetTempPath(), $"radiology-ppt-{label}-{Guid.NewGuid():N}.json");
        await File.WriteAllTextAsync(
            tempPath,
            node.ToJsonString(new JsonSerializerOptions { WriteIndented = true }),
            Encoding.UTF8,
            cancellationToken);
        return tempPath;
    }

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch
        {
            // Temporary cleanup should not hide the real workflow result.
        }
    }

    private async Task<JsonObject> RunServiceAsync(string command, JsonObject payload, Action<string> log, CancellationToken cancellationToken)
    {
        if (!File.Exists(ServiceScript))
        {
            throw new FileNotFoundException("The backend service was not found.", ServiceScript);
        }

        await EnsureServiceAsync(log, cancellationToken);
        var service = _serviceProcess ?? throw new InvalidOperationException("The backend service is not running.");
        var id = Guid.NewGuid().ToString("N");
        var pending = new PendingServiceRequest(log);
        lock (_pendingLock)
        {
            _pendingRequests[id] = pending;
        }

        using var registration = cancellationToken.Register(() =>
        {
            pending.Completion.TrySetCanceled(cancellationToken);
            CancelCurrentProcess();
        });

        try
        {
            var request = new JsonObject
            {
                ["id"] = id,
                ["command"] = command,
                ["payload"] = payload.DeepClone()
            };
            await _serviceWriteLock.WaitAsync(cancellationToken);
            try
            {
                if (service.HasExited)
                {
                    throw new InvalidOperationException("The backend service exited before the request could be sent.");
                }

                await service.StandardInput.WriteLineAsync(request.ToJsonString());
                await service.StandardInput.FlushAsync(cancellationToken);
            }
            finally
            {
                _serviceWriteLock.Release();
            }

            using var longRunningLogCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            var longRunningLogTask = LogLongRunningRequestAsync(command, pending, longRunningLogCancellation.Token);
            try
            {
                return await pending.Completion.Task.WaitAsync(cancellationToken);
            }
            finally
            {
                longRunningLogCancellation.Cancel();
                try
                {
                    await longRunningLogTask;
                }
                catch (OperationCanceledException)
                {
                    // Expected when the backend finishes before the reminder loop fires again.
                }
            }
        }
        finally
        {
            lock (_pendingLock)
            {
                _pendingRequests.Remove(id);
            }
        }
    }

    private static async Task LogLongRunningRequestAsync(string command, PendingServiceRequest pending, CancellationToken cancellationToken)
    {
        var startedAt = DateTimeOffset.Now;
        await Task.Delay(LongRunningLogDelay, cancellationToken);
        while (!cancellationToken.IsCancellationRequested && !pending.Completion.Task.IsCompleted)
        {
            var elapsed = DateTimeOffset.Now - startedAt;
            pending.Log($"Still working on {DescribeCommand(command)} ({FormatElapsed(elapsed)} elapsed)...");
            await Task.Delay(LongRunningLogInterval, cancellationToken);
        }
    }

    private static string DescribeCommand(string command)
    {
        return command switch
        {
            "prepare" => "case preparation",
            "render" => "PowerPoint creation",
            "scoreImages" => "Ollama scoring",
            "coreReviewIngestPdf" => "Core Boards PDF import",
            "coreReviewIngest" => "Core Boards text import",
            "coreReviewQuiz" => "Core Boards quiz generation",
            _ => command
        };
    }

    private static string FormatElapsed(TimeSpan elapsed)
    {
        return elapsed.TotalMinutes >= 1
            ? $"{elapsed.TotalMinutes:0.0} min"
            : $"{elapsed.TotalSeconds:0} sec";
    }

    private async Task EnsureServiceAsync(Action<string> log, CancellationToken cancellationToken)
    {
        if (_serviceProcess is { HasExited: false })
        {
            return;
        }

        await _serviceStartLock.WaitAsync(cancellationToken);
        try
        {
            if (_serviceProcess is { HasExited: false })
            {
                return;
            }

            var startInfo = new ProcessStartInfo(NodePath)
            {
                WorkingDirectory = ProjectRoot,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                RedirectStandardInput = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
                StandardInputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false)
            };
            startInfo.ArgumentList.Add(ServiceScript);
            startInfo.Environment["RADIOLOGY_PPT_APP_ROOT"] = AppRoot;
            startInfo.Environment["RADIOLOGY_PPT_RESOURCE_ROOT"] = ResourceRoot;
            startInfo.Environment["RADIOLOGY_PPT_DATABASE_PATH"] = Path.Combine(StateDir, "radiology-ppt.sqlite");
            startInfo.Environment["NODE_NO_WARNINGS"] = "1";

            var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
            process.Exited += (_, _) => FailPendingServiceRequests("The backend service exited.");
            if (!process.Start())
            {
                throw new InvalidOperationException("Could not start the backend service.");
            }

            _serviceProcess = process;
            _ = Task.Run(() => ReadServiceStdoutAsync(process));
            _ = Task.Run(() => ReadServiceStderrAsync(process, log));
            log("Backend service started.");
        }
        finally
        {
            _serviceStartLock.Release();
        }
    }

    private async Task ReadServiceStdoutAsync(Process process)
    {
        try
        {
            while (!process.HasExited)
            {
                var line = await process.StandardOutput.ReadLineAsync();
                if (line is null)
                {
                    break;
                }
                HandleServiceLine(line);
            }
        }
        catch (Exception exception)
        {
            FailPendingServiceRequests($"Could not read backend service output: {exception.Message}");
        }
    }

    private async Task ReadServiceStderrAsync(Process process, Action<string> fallbackLog)
    {
        try
        {
            while (!process.HasExited)
            {
                var line = await process.StandardError.ReadLineAsync();
                if (line is null)
                {
                    break;
                }
                if (TryParseBackendEvent(line, out var progressMessage))
                {
                    LogToPendingRequests(progressMessage, fallbackLog);
                }
                else
                {
                    LogToPendingRequests(line, fallbackLog);
                }
            }
        }
        catch
        {
            // The stdout reader handles pending request failure on service exit.
        }
    }

    private void HandleServiceLine(string line)
    {
        JsonObject? message;
        try
        {
            message = JsonNode.Parse(line)?.AsObject();
        }
        catch
        {
            LogToPendingRequests(line, _ => { });
            return;
        }

        if (message is null)
        {
            return;
        }

        var id = TextValue(message, "id");
        var type = TextValue(message, "type");
        PendingServiceRequest? pending;
        lock (_pendingLock)
        {
            _pendingRequests.TryGetValue(id, out pending);
        }
        if (pending is null)
        {
            if (type.Equals("error", StringComparison.OrdinalIgnoreCase))
            {
                FailPendingServiceRequests(TextValue(message, "error", "Backend service request failed before it could be matched to a job."));
            }
            return;
        }

        if (type.Equals("event", StringComparison.OrdinalIgnoreCase))
        {
            if (TryFormatServiceEvent(message["payload"] as JsonObject, out var displayMessage))
            {
                pending.Log(displayMessage);
            }
            return;
        }
        if (type.Equals("result", StringComparison.OrdinalIgnoreCase))
        {
            pending.Completion.TrySetResult(message["payload"]?.AsObject() ?? new JsonObject());
            return;
        }
        if (type.Equals("error", StringComparison.OrdinalIgnoreCase))
        {
            pending.Completion.TrySetException(new InvalidOperationException(TextValue(message, "error", "Backend service request failed.")));
        }
    }

    private void FailPendingServiceRequests(string message)
    {
        PendingServiceRequest[] pending;
        lock (_pendingLock)
        {
            pending = _pendingRequests.Values.ToArray();
            _pendingRequests.Clear();
        }
        foreach (var request in pending)
        {
            request.Completion.TrySetException(new InvalidOperationException(message));
        }
    }

    private void LogToPendingRequests(string message, Action<string> fallbackLog)
    {
        PendingServiceRequest[] pending;
        lock (_pendingLock)
        {
            pending = _pendingRequests.Values.ToArray();
        }
        if (pending.Length == 0)
        {
            fallbackLog(message);
            return;
        }
        foreach (var request in pending)
        {
            request.Log(message);
        }
    }

    private static JsonObject BuildPrepareArgs(GenerationSettings settings)
    {
        return new JsonObject
        {
            ["imagesPerCase"] = settings.ImagesPerCase,
            ["useClinicalHistory"] = settings.UseClinicalHistory,
            ["useOllamaAssist"] = settings.UseOllamaReview,
            ["ollamaModel"] = settings.OllamaModel
        };
    }

    private static bool TryFormatServiceEvent(JsonObject? payload, out string displayMessage)
    {
        displayMessage = "";
        if (payload is null)
        {
            return false;
        }

        var type = TextValue(payload, "type", "progress");
        var message = TextValue(payload, "message");
        if (string.IsNullOrWhiteSpace(message))
        {
            return false;
        }
        displayMessage = type.Equals("warning", StringComparison.OrdinalIgnoreCase)
            ? $"Warning: {message}"
            : message;
        return true;
    }

    private static bool TryParseBackendEvent(string line, out string displayMessage)
    {
        displayMessage = "";
        const string prefix = "RP_EVENT ";
        if (!line.StartsWith(prefix, StringComparison.Ordinal))
        {
            return false;
        }

        try
        {
            var payload = JsonNode.Parse(line[prefix.Length..])?.AsObject();
            var type = payload?["type"]?.GetValue<string>() ?? "progress";
            var message = payload?["message"]?.GetValue<string>() ?? "";
            if (string.IsNullOrWhiteSpace(message))
            {
                return true;
            }

            displayMessage = type.Equals("warning", StringComparison.OrdinalIgnoreCase)
                ? $"Warning: {message}"
                : message;
            return true;
        }
        catch
        {
            displayMessage = line;
            return false;
        }
    }

    private static string TextValue(JsonObject? node, string name, string fallback = "")
    {
        if (node is null || node[name] is null)
        {
            return fallback;
        }

        try
        {
            return node[name]!.ToString();
        }
        catch
        {
            return fallback;
        }
    }

    private static string ResolveProjectRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            if (File.Exists(Path.Combine(directory.FullName, "src", "cli.mjs")))
            {
                return directory.FullName;
            }
            directory = directory.Parent;
        }

        throw new DirectoryNotFoundException("Could not find the radiology-ppt project root containing src\\cli.mjs.");
    }

    private static string ResolveNodePath()
    {
        var projectRoot = ResolveProjectRoot();
        var packaged = Path.Combine(projectRoot, "runtime", "node.exe");
        if (File.Exists(packaged))
        {
            return packaged;
        }

        var bundled = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".cache",
            "codex-runtimes",
            "codex-primary-runtime",
            "dependencies",
            "node",
            "bin",
            "node.exe");
        if (File.Exists(bundled))
        {
            return bundled;
        }

        return "node";
    }

    private sealed record BackendResult(int ExitCode, string Stdout, string Stderr);

    private sealed class PendingServiceRequest(Action<string> log)
    {
        public TaskCompletionSource<JsonObject> Completion { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Action<string> Log { get; } = log;
    }
}
