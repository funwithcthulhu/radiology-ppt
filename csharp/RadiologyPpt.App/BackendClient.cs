using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace RadiologyPpt.App;

public sealed class BackendClient
{
    private Process? _currentProcess;

    public BackendClient()
    {
        ProjectRoot = ResolveProjectRoot();
        AppRoot = ProjectRoot;
        ResourceRoot = ProjectRoot;
        CliScript = Path.Combine(ResourceRoot, "src", "cli.mjs");
        NodePath = ResolveNodePath();
    }

    public string ProjectRoot { get; }
    public string AppRoot { get; }
    public string ResourceRoot { get; }
    public string CliScript { get; }
    public string NodePath { get; }

    public string OutputsDir => Path.Combine(AppRoot, "outputs");
    public string BoardReviewDir => Path.Combine(AppRoot, "library", "board-review");
    public string BoardReviewCorpusPath => Path.Combine(BoardReviewDir, "pdf-corpus.json");

    public async Task<JsonObject> PrepareAsync(IEnumerable<JsonObject> entries, GenerationSettings settings, Action<string> log, CancellationToken cancellationToken)
    {
        var requestPath = await WriteTempJsonAsync(new JsonArray(entries.Select(entry => entry.DeepClone()).ToArray()), "requests", cancellationToken);
        try
        {
            var args = new List<string>
            {
                "--prepare-input",
                requestPath,
                "--images-per-case",
                settings.ImagesPerCase.ToString()
            };
            if (settings.UseClinicalHistory)
            {
                args.Add("--use-clinical-history");
            }
            if (settings.UseOllamaReview)
            {
                args.Add("--use-ollama-assist");
                if (!string.IsNullOrWhiteSpace(settings.OllamaModel))
                {
                    args.Add("--ollama-model");
                    args.Add(settings.OllamaModel);
                }
            }

            var result = await RunCliAsync(args, log, cancellationToken);
            ThrowIfFailed(result, "Could not prepare case previews.");
            return JsonNode.Parse(result.Stdout)?.AsObject()
                ?? throw new InvalidOperationException("Prepare did not return JSON.");
        }
        finally
        {
            TryDelete(requestPath);
        }
    }

    public async Task<JsonObject?> PrepareSingleAsync(JsonObject request, GenerationSettings settings, Action<string> log, CancellationToken cancellationToken)
    {
        var payload = await PrepareAsync([request], settings, log, cancellationToken);
        var items = payload["items"]?.AsArray();
        return items is { Count: > 0 } ? items[0]?.AsObject() : null;
    }

    public async Task<string> RenderAsync(IEnumerable<JsonObject> approvedItems, GenerationSettings settings, Action<string> log, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(OutputsDir);
        var preparedPath = await WriteTempJsonAsync(
            new JsonObject { ["items"] = new JsonArray(approvedItems.Select(item => item.DeepClone()).ToArray()) },
            "prepared",
            cancellationToken);
        try
        {
            var args = new List<string>
            {
                "--render-input",
                preparedPath,
                "--deck-mode",
                settings.PowerPointStyle,
                "--theme",
                settings.Theme
            };
            if (!string.IsNullOrWhiteSpace(settings.Title))
            {
                args.Add("--title");
                args.Add(settings.Title);
            }
            if (!string.IsNullOrWhiteSpace(settings.OutputPath))
            {
                args.Add("--out");
                args.Add(settings.OutputPath);
            }
            if (settings.IncludeTeachingPoints)
            {
                args.Add("--include-teaching-points");
            }

            var result = await RunCliAsync(args, log, cancellationToken);
            ThrowIfFailed(result, "Could not create the PowerPoint.");
            return result.Stdout;
        }
        finally
        {
            TryDelete(preparedPath);
        }
    }

    public async Task ImportCoreReviewPdfsAsync(IEnumerable<string> pdfPaths, string domain, Action<string> log, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(BoardReviewDir);
        var args = new List<string>
        {
            "--core-review-ingest-pdf"
        };
        args.AddRange(pdfPaths);
        args.AddRange(["--out", BoardReviewCorpusPath, "--format", "text"]);
        if (!string.IsNullOrWhiteSpace(domain))
        {
            args.AddRange(["--domain", domain]);
        }

        var result = await RunCliAsync(args, log, cancellationToken);
        ThrowIfFailed(result, "Could not import Core Boards PDFs.");
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

    private async Task<BackendResult> RunCliAsync(IEnumerable<string> args, Action<string> log, CancellationToken cancellationToken)
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
            log(eventArgs.Data);
        };
        process.ErrorDataReceived += (_, eventArgs) =>
        {
            if (eventArgs.Data is null)
            {
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
}
