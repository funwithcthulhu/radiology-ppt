using System.ComponentModel;
using System.Text.Json.Nodes;

namespace RadiologyPpt.App;

public sealed record CoreReviewExerciseTypeOption(string Label, string Value);

public sealed class ReviewImageItem : INotifyPropertyChanged
{
    private bool _keep = true;

    public event PropertyChangedEventHandler? PropertyChanged;

    public bool Keep
    {
        get => _keep;
        set
        {
            if (_keep == value)
            {
                return;
            }
            _keep = value;
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Keep)));
        }
    }

    public string ImageSource { get; init; } = "";
    public string Caption { get; init; } = "";
    public string SelectionExplanation { get; init; } = "";
    public string OllamaText { get; init; } = "";
    public string FrameId { get; init; } = "";
    public JsonObject Source { get; init; } = new();
}

public sealed class CandidateImageItem : INotifyPropertyChanged
{
    private bool _use;

    public event PropertyChangedEventHandler? PropertyChanged;

    public bool Use
    {
        get => _use;
        set
        {
            if (_use == value)
            {
                return;
            }
            _use = value;
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Use)));
        }
    }

    public string PreviewSource { get; init; } = "";
    public string Caption { get; init; } = "";
    public string ScoreText { get; init; } = "";
    public string FrameId { get; init; } = "";
    public JsonObject Source { get; init; } = new();
}
