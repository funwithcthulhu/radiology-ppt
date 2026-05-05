using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;

namespace RadiologyPpt.App;

public sealed class MainWindowViewModel : INotifyPropertyChanged
{
    private string _statusText = "Ready";
    private string _lastPowerPointText = "No PowerPoint generated yet";

    public event PropertyChangedEventHandler? PropertyChanged;

    public ObservableCollection<CaseRequestRow> Requests { get; } = [];

    public string StatusText
    {
        get => _statusText;
        set => SetField(ref _statusText, value);
    }

    public string LastPowerPointText
    {
        get => _lastPowerPointText;
        set => SetField(ref _lastPowerPointText, value);
    }

    public CaseRequestRow[] UsableRows()
    {
        return Requests.Where(IsUsableRow).ToArray();
    }

    public List<JsonObject> BuildRequestPayloads(IReadOnlyList<CaseRequestRow> rows, GenerationSettings settings)
    {
        return rows.Select((row, index) => row.ToPayload(index + 1, settings)).ToList();
    }

    public GenerationSettings BuildSettings(PowerPointSettingsSnapshot snapshot)
    {
        var imagesPerCase = 3;
        if (int.TryParse(snapshot.ImagesPerCase, out var parsed))
        {
            imagesPerCase = Math.Max(1, Math.Min(8, parsed));
        }

        return new GenerationSettings
        {
            Title = snapshot.Title.Trim(),
            ImagesPerCase = imagesPerCase,
            OutputPath = snapshot.OutputPath.Trim(),
            AutoOpen = snapshot.AutoOpen,
            UseClinicalHistory = snapshot.UseClinicalHistory,
            UseOllamaReview = snapshot.UseOllamaReview,
            OllamaModel = snapshot.OllamaModel.Trim(),
            Theme = AppOptions.ThemeCliValue(snapshot.Theme),
            PowerPointStyle = AppOptions.PowerPointStyleCliValue(snapshot.PowerPointStyle),
            CoreReviewQuestionSource = AppOptions.CoreReviewQuestionSourceCliValue(snapshot.CoreReviewQuestionSource),
            CoreReviewQuestionBankPath = snapshot.CoreReviewQuestionBankPath.Trim(),
            IncludeTeachingPoints = snapshot.IncludeTeachingPoints,
            OnlyNewRandomCases = snapshot.OnlyNewRandomCases
        };
    }

    public static bool IsUsableRow(CaseRequestRow row)
    {
        if (row.Mode == AppOptions.RequestModes[1])
        {
            return row.Count > 0;
        }
        return !string.IsNullOrWhiteSpace(row.Query);
    }

    public static string BuildRequestSummary(IReadOnlyCollection<CaseRequestRow> rows, int preparedCount)
    {
        return $"{rows.Count} row(s), {preparedCount} prepared case(s)";
    }

    public static string BuildExportSummary(IReadOnlyCollection<JsonObject> approvedItems)
    {
        var weakCases = approvedItems.Count(item =>
        {
            var warnings = item["caseData"]?["quality"]?["warnings"]?.AsArray();
            return warnings is { Count: > 0 };
        });
        var imageCount = approvedItems.Sum(item => item["caseData"]?["images"]?.AsArray().Count ?? 0);
        return $"Export summary: {approvedItems.Count} case(s), {imageCount} selected image(s), {weakCases} case(s) with quality warning(s).";
    }

    public static string BuildFailureMessage(string[] failures)
    {
        if (failures.Length == 0)
        {
            return "No usable cases were prepared. Try broader filters or a different request.";
        }
        return "No usable cases were prepared." + Environment.NewLine + Environment.NewLine + string.Join(Environment.NewLine, failures);
    }

    private void SetField<T>(ref T field, T value, [CallerMemberName] string? propertyName = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}

public sealed record PowerPointSettingsSnapshot(
    string Title,
    string ImagesPerCase,
    string OutputPath,
    bool AutoOpen,
    bool UseClinicalHistory,
    bool UseOllamaReview,
    string OllamaModel,
    string Theme,
    string PowerPointStyle,
    string CoreReviewQuestionSource,
    string CoreReviewQuestionBankPath,
    bool IncludeTeachingPoints,
    bool OnlyNewRandomCases);
