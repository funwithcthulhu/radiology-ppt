namespace RadiologyPpt.App;

public sealed class BackendHealthMonitor : IDisposable
{
    private readonly BackendClient _backend;
    private readonly Action<string> _log;
    private readonly TimeSpan _interval;
    private readonly TimeSpan _timeout;
    private CancellationTokenSource? _cancellation;
    private Task? _loop;

    public BackendHealthMonitor(
        BackendClient backend,
        Action<string> log,
        TimeSpan? interval = null,
        TimeSpan? timeout = null)
    {
        _backend = backend;
        _log = log;
        _interval = interval ?? TimeSpan.FromSeconds(20);
        _timeout = timeout ?? TimeSpan.FromSeconds(5);
    }

    public event EventHandler<string>? StatusChanged;

    public void Start()
    {
        if (_loop is not null)
        {
            return;
        }

        _cancellation = new CancellationTokenSource();
        _loop = Task.Run(() => RunAsync(_cancellation.Token));
    }

    public async Task StopAsync()
    {
        if (_cancellation is null)
        {
            return;
        }

        await _cancellation.CancelAsync();
        if (_loop is not null)
        {
            try
            {
                await _loop;
            }
            catch (OperationCanceledException)
            {
                // Normal shutdown path.
            }
        }

        _cancellation.Dispose();
        _cancellation = null;
        _loop = null;
    }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(_interval);
        while (await timer.WaitForNextTickAsync(cancellationToken))
        {
            if (_backend.HasPendingRequests)
            {
                continue;
            }

            using var pingCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            pingCancellation.CancelAfter(_timeout);
            try
            {
                await _backend.PingAsync(_ => { }, pingCancellation.Token);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                await RestartAfterFailureAsync("Backend health check timed out.", cancellationToken);
            }
            catch (Exception exception) when (!cancellationToken.IsCancellationRequested)
            {
                await RestartAfterFailureAsync($"Backend health check failed: {exception.Message}", cancellationToken);
            }
        }
    }

    private async Task RestartAfterFailureAsync(string message, CancellationToken cancellationToken)
    {
        if (_backend.HasPendingRequests)
        {
            _log($"{message} Backend work is active, so automatic restart was deferred.");
            StatusChanged?.Invoke(this, "Backend health check deferred during active work");
            return;
        }

        _log($"{message} Restarting backend service...");
        StatusChanged?.Invoke(this, "Restarting backend service...");
        await _backend.RestartServiceAsync(_log, cancellationToken);
        StatusChanged?.Invoke(this, "Backend service restarted");
    }

    public void Dispose()
    {
        if (_cancellation is not null)
        {
            _cancellation.Cancel();
            _cancellation.Dispose();
        }
    }
}

public sealed record BackendHealthSnapshot(
    string Service,
    string Pid,
    string StartedAt,
    string UptimeMs,
    string HandledRequests,
    string LastRequestAt);
