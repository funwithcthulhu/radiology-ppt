using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace RadiologyPpt.App;

public sealed class BackendClient
{
    private Process? _serviceProcess;
    private readonly SemaphoreSlim _serviceStartLock = new(1, 1);
    private readonly SemaphoreSlim _serviceWriteLock = new(1, 1);
    private readonly object _pendingLock = new();
    private readonly object _serviceDiagnosticsLock = new();
    private readonly Dictionary<string, PendingServiceRequest> _pendingRequests = new(StringComparer.Ordinal);
    private readonly Queue<string> _recentServiceDiagnostics = new();
    private static readonly TimeSpan LongRunningLogDelay = TimeSpan.FromSeconds(12);
    private static readonly TimeSpan LongRunningLogInterval = TimeSpan.FromSeconds(20);
    private const int RecentServiceDiagnosticLimit = 25;

    public BackendClient()
    {
        ProjectRoot = ResolveProjectRoot();
        ResourceRoot = ProjectRoot;
        AppRoot = ResolveAppRoot(ResourceRoot);
        ServiceScript = Path.Combine(ResourceRoot, "src", "backend-service.mjs");
        NodePath = ResolveNodePath();
    }

    public string ProjectRoot { get; }
    public string AppRoot { get; }
    public string ResourceRoot { get; }
    public string ServiceScript { get; }
    public string NodePath { get; }

    public string OutputsDir => Path.Combine(AppRoot, "outputs");
    public string StateDir => Path.Combine(AppRoot, "state");
    public string BoardReviewDir => Path.Combine(AppRoot, "library", "board-review");
    public string BoardReviewPdfCorpusPath => Path.Combine(BoardReviewDir, "pdf-corpus.json");
    public string BoardReviewTextCorpusPath => Path.Combine(BoardReviewDir, "corpus.json");

    public event EventHandler<BackendProgressEvent>? ProgressReceived;

    public async Task<JsonObject> PrepareAsync(IEnumerable<JsonObject> entries, GenerationSettings settings, Action<string> log, CancellationToken cancellationToken)
    {
        return await RunServiceAsync("prepare", BackendPayloads.Prepare(entries, settings), log, cancellationToken);
    }

    public async Task<JsonObject> PrepareCoreReviewDeckAsync(CoreReviewDeckSettings deckSettings, GenerationSettings settings, Action<string> log, CancellationToken cancellationToken)
    {
        return await RunServiceAsync("coreReviewPrepareDeck", BackendPayloads.CoreReviewDeck(deckSettings, settings), log, cancellationToken);
    }

    public async Task<JsonObject?> PrepareSingleAsync(JsonObject request, GenerationSettings settings, Action<string> log, CancellationToken cancellationToken)
    {
        var payload = await PrepareAsync([request], settings, log, cancellationToken);
        var items = payload["items"]?.AsArray();
        return items is { Count: > 0 } ? items[0]?.AsObject() : null;
    }

    public async Task<JsonObject?> ScoreImagesAsync(JsonObject item, GenerationSettings settings, Action<string> log, CancellationToken cancellationToken)
    {
        var result = await RunServiceAsync("scoreImages", BackendPayloads.ScoreImages(item, settings), log, cancellationToken);
        var items = result["items"]?.AsArray();
        return items is { Count: > 0 } ? items[0]?.AsObject() : null;
    }

    public async Task<string> RenderAsync(IEnumerable<JsonObject> approvedItems, GenerationSettings settings, Action<string> log, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(OutputsDir);
        var result = await RunServiceAsync("render", BackendPayloads.Render(approvedItems, settings), log, cancellationToken);
        return $"Created PowerPoint: {TextValue(result, "outputPath")}{Environment.NewLine}Created manifest: {TextValue(result, "manifestPath")}{Environment.NewLine}";
    }

    public async Task ImportCoreReviewPdfsAsync(IEnumerable<string> pdfPaths, string domain, Action<string> log, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(BoardReviewDir);
        await RunServiceAsync("coreReviewIngestPdf", BackendPayloads.CoreReviewPdfImport(pdfPaths, domain, BoardReviewPdfCorpusPath), log, cancellationToken);
    }

    public async Task ImportCoreReviewSourcesAsync(IEnumerable<string> sourcePaths, string domain, Action<string> log, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(BoardReviewDir);
        await RunServiceAsync("coreReviewIngest", BackendPayloads.CoreReviewSourceImport(sourcePaths, domain, BoardReviewTextCorpusPath), log, cancellationToken);
    }

    public async Task<BackendHealthSnapshot> PingAsync(Action<string> log, CancellationToken cancellationToken)
    {
        var payload = await RunServiceAsync("ping", BackendPayloads.Empty(), log, cancellationToken);
        return new BackendHealthSnapshot(
            BackendPayloadReader.TextValue(payload, "service", "radiology-ppt-backend"),
            BackendPayloadReader.TextValue(payload, "pid"),
            BackendPayloadReader.TextValue(payload, "startedAt"),
            BackendPayloadReader.TextValue(payload, "uptimeMs"),
            BackendPayloadReader.TextValue(payload, "handledRequests"),
            BackendPayloadReader.TextValue(payload, "lastRequestAt"));
    }

    public async Task RestartServiceAsync(Action<string> log, CancellationToken cancellationToken)
    {
        CancelCurrentProcess();
        await EnsureServiceAsync(log, cancellationToken);
    }

    public bool HasPendingRequests
    {
        get
        {
            lock (_pendingLock)
            {
                return _pendingRequests.Count > 0;
            }
        }
    }

    public void CancelCurrentProcess()
    {
        try
        {
            if (_serviceProcess is { HasExited: false })
            {
                _serviceProcess.Kill(entireProcessTree: true);
            }
            _serviceProcess = null;
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

            var stdoutTask = process.StandardOutput.ReadToEndAsync();
            var stderrTask = process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync();
            _ = await stderrTask;
            var stdout = await stdoutTask;
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

    private async Task<JsonObject> RunServiceAsync(string command, JsonObject payload, Action<string> log, CancellationToken cancellationToken)
    {
        if (!File.Exists(ServiceScript))
        {
            throw new FileNotFoundException("The backend service was not found.", ServiceScript);
        }

        for (var attempt = 1; attempt <= 2; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                return await RunServiceAttemptAsync(command, payload, log, cancellationToken);
            }
            catch (BackendServiceExitedException) when (attempt == 1 && !cancellationToken.IsCancellationRequested)
            {
                log($"Backend service exited during {DescribeCommand(command)}; restarting and retrying once.");
                await RestartServiceAsync(log, cancellationToken);
            }
            catch (IOException exception) when (attempt == 1 && !cancellationToken.IsCancellationRequested)
            {
                log($"Lost connection to the backend during {DescribeCommand(command)}: {exception.Message}. Restarting and retrying once.");
                CancelCurrentProcess();
                await EnsureServiceAsync(log, cancellationToken);
            }
            catch (ObjectDisposedException exception) when (attempt == 1 && !cancellationToken.IsCancellationRequested)
            {
                log($"Backend connection closed during {DescribeCommand(command)}: {exception.Message}. Restarting and retrying once.");
                CancelCurrentProcess();
                await EnsureServiceAsync(log, cancellationToken);
            }
        }

        throw new InvalidOperationException("Backend service request failed.");
    }

    private async Task<JsonObject> RunServiceAttemptAsync(string command, JsonObject payload, Action<string> log, CancellationToken cancellationToken)
    {
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
                    throw BuildServiceExitException(service);
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
            "coreReviewPrepareDeck" => "Core Review PowerPoint planning",
            "render" => "PowerPoint creation",
            "scoreImages" => "Ollama scoring",
            "coreReviewIngestPdf" => "Core Review PDF import",
            "coreReviewIngest" => "Core Review text import",
            "coreReviewQuiz" => "Core Review quiz generation",
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
            process.Exited += (_, _) => _ = Task.Run(async () =>
            {
                await Task.Delay(150);
                var exception = BuildServiceExitException(process);
                log(exception.Message);
                FailPendingServiceRequests(exception);
            });
            if (!process.Start())
            {
                throw new InvalidOperationException("Could not start the backend service.");
            }

            _serviceProcess = process;
            ClearServiceDiagnostics();
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
            while (true)
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
            while (true)
            {
                var line = await process.StandardError.ReadLineAsync();
                if (line is null)
                {
                    break;
                }
                RememberServiceDiagnostic(line);
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
            RememberServiceDiagnostic(line);
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
            if (TryParseServiceEvent(message["payload"] as JsonObject, out var progressEvent))
            {
                NotifyProgressReceived(progressEvent);
                var displayMessage = FormatServiceEvent(progressEvent);
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
        FailPendingServiceRequests(new InvalidOperationException(message));
    }

    private void FailPendingServiceRequests(Exception exception)
    {
        PendingServiceRequest[] pending;
        lock (_pendingLock)
        {
            pending = _pendingRequests.Values.ToArray();
            _pendingRequests.Clear();
        }
        foreach (var request in pending)
        {
            request.Completion.TrySetException(exception);
        }
    }

    private BackendServiceExitedException BuildServiceExitException(Process process)
    {
        var exitCode = TryGetExitCode(process);
        var message = exitCode is null
            ? "The backend service exited unexpectedly."
            : $"The backend service exited unexpectedly (exit code {exitCode}).";
        var diagnostics = RecentServiceDiagnosticsText();
        if (!string.IsNullOrWhiteSpace(diagnostics))
        {
            message += $"{Environment.NewLine}{Environment.NewLine}Recent backend output:{Environment.NewLine}{diagnostics}";
        }

        return new BackendServiceExitedException(message);
    }

    private static int? TryGetExitCode(Process process)
    {
        try
        {
            return process.HasExited ? process.ExitCode : null;
        }
        catch
        {
            return null;
        }
    }

    private void RememberServiceDiagnostic(string line)
    {
        var cleanLine = line.Trim();
        if (string.IsNullOrWhiteSpace(cleanLine))
        {
            return;
        }

        lock (_serviceDiagnosticsLock)
        {
            _recentServiceDiagnostics.Enqueue(cleanLine);
            while (_recentServiceDiagnostics.Count > RecentServiceDiagnosticLimit)
            {
                _recentServiceDiagnostics.Dequeue();
            }
        }
    }

    private string RecentServiceDiagnosticsText()
    {
        lock (_serviceDiagnosticsLock)
        {
            return string.Join(Environment.NewLine, _recentServiceDiagnostics);
        }
    }

    private void ClearServiceDiagnostics()
    {
        lock (_serviceDiagnosticsLock)
        {
            _recentServiceDiagnostics.Clear();
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

    private void NotifyProgressReceived(BackendProgressEvent progressEvent)
    {
        try
        {
            ProgressReceived?.Invoke(this, progressEvent);
        }
        catch
        {
            // Progress display should never break the backend request.
        }
    }

    private static bool TryParseServiceEvent(JsonObject? payload, out BackendProgressEvent progressEvent)
    {
        progressEvent = BackendProgressEvent.Empty;
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

        var detail = payload["detail"]?.DeepClone() as JsonObject ?? new JsonObject();
        var createdAtText = TextValue(payload, "createdAt");
        var createdAt = DateTimeOffset.TryParse(createdAtText, out var parsedCreatedAt)
            ? parsedCreatedAt
            : DateTimeOffset.Now;
        progressEvent = new BackendProgressEvent(type, message, detail, createdAt);
        return true;
    }

    private static string FormatServiceEvent(BackendProgressEvent progressEvent)
    {
        return progressEvent.Type.Equals("warning", StringComparison.OrdinalIgnoreCase)
            ? $"Warning: {progressEvent.Message}"
            : progressEvent.Message;
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
            if (File.Exists(Path.Combine(directory.FullName, "src", "backend-service.mjs")))
            {
                return directory.FullName;
            }
            directory = directory.Parent;
        }

        throw new DirectoryNotFoundException("Could not find the radiology-ppt project root containing src\\backend-service.mjs.");
    }

    private static string ResolveNodePath()
    {
        var projectRoot = ResolveProjectRoot();
        var packaged = Path.Combine(projectRoot, "runtime", "node.exe");
        if (File.Exists(packaged))
        {
            return packaged;
        }

        return "node";
    }

    private static string ResolveAppRoot(string resourceRoot)
    {
        if (Directory.Exists(Path.Combine(resourceRoot, ".git")))
        {
            return resourceRoot;
        }

        var appDataRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "RadiopaediaCasePowerPointBuilder");
        Directory.CreateDirectory(appDataRoot);
        return appDataRoot;
    }

    private sealed class PendingServiceRequest(Action<string> log)
    {
        public TaskCompletionSource<JsonObject> Completion { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Action<string> Log { get; } = log;
    }

    private sealed class BackendServiceExitedException(string message) : InvalidOperationException(message);
}

public sealed record BackendProgressEvent(
    string Type,
    string Message,
    JsonObject Detail,
    DateTimeOffset CreatedAt)
{
    public static BackendProgressEvent Empty { get; } = new("", "", new JsonObject(), DateTimeOffset.MinValue);
}
