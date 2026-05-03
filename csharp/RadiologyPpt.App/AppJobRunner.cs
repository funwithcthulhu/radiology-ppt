namespace RadiologyPpt.App;

public sealed class AppJobRunner
{
    private readonly object _lock = new();
    private CancellationTokenSource? _cancellation;
    private AppJobSnapshot? _current;

    public bool IsRunning
    {
        get
        {
            lock (_lock)
            {
                return _current is not null;
            }
        }
    }

    public async Task<T> RunAsync<T>(
        string name,
        Action<AppJobSnapshot> onChanged,
        Func<CancellationToken, Task<T>> work)
    {
        CancellationTokenSource cancellation;
        var snapshot = new AppJobSnapshot(Guid.NewGuid().ToString("N"), name, AppJobStatus.Running, DateTimeOffset.Now, null, null);

        lock (_lock)
        {
            if (_current is not null)
            {
                throw new InvalidOperationException($"Another task is already running: {_current.Name}");
            }

            _cancellation = new CancellationTokenSource();
            cancellation = _cancellation;
            _current = snapshot;
        }

        try
        {
            TryNotify(onChanged, snapshot);
            var result = await work(cancellation.Token);
            TryNotify(onChanged, snapshot with { Status = AppJobStatus.Completed, CompletedAt = DateTimeOffset.Now });
            return result;
        }
        catch (OperationCanceledException)
        {
            TryNotify(onChanged, snapshot with { Status = AppJobStatus.Cancelled, CompletedAt = DateTimeOffset.Now });
            throw;
        }
        catch
        {
            TryNotify(onChanged, snapshot with { Status = AppJobStatus.Failed, CompletedAt = DateTimeOffset.Now });
            throw;
        }
        finally
        {
            lock (_lock)
            {
                if (ReferenceEquals(_cancellation, cancellation))
                {
                    _cancellation = null;
                    _current = null;
                }
            }

            cancellation.Dispose();
        }
    }

    public void Cancel()
    {
        lock (_lock)
        {
            _cancellation?.Cancel();
        }
    }

    private static void TryNotify(Action<AppJobSnapshot> onChanged, AppJobSnapshot snapshot)
    {
        try
        {
            onChanged(snapshot);
        }
        catch
        {
            // Status notifications are best-effort; they should not strand the job runner in a busy state.
        }
    }
}

public sealed record AppJobSnapshot(
    string Id,
    string Name,
    AppJobStatus Status,
    DateTimeOffset StartedAt,
    DateTimeOffset? CompletedAt,
    string? Detail);

public enum AppJobStatus
{
    Running,
    Completed,
    Cancelled,
    Failed
}
