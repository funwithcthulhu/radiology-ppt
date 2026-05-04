using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace RadiologyPpt.App;

public sealed class CaseRequestRow : INotifyPropertyChanged
{
    private string _mode = AppOptions.RequestModes[0];
    private string _query = "";
    private int _count = 1;
    private string _modality = "Any";
    private string _anatomy = "Any";
    private string _subspecialty = "Any";
    private string _secondaryModality = "Any";
    private string _ageGroup = "Any";
    private string _topicFocus = "Any";
    private string _difficulty = "Any";

    public event PropertyChangedEventHandler? PropertyChanged;

    public string Mode
    {
        get => _mode;
        set => SetField(ref _mode, value);
    }

    public string Query
    {
        get => _query;
        set => SetField(ref _query, value);
    }

    public int Count
    {
        get => _count;
        set => SetField(ref _count, Math.Max(1, Math.Min(20, value)));
    }

    public string Modality
    {
        get => _modality;
        set => SetField(ref _modality, value);
    }

    public string Anatomy
    {
        get => _anatomy;
        set => SetField(ref _anatomy, value);
    }

    public string Subspecialty
    {
        get => _subspecialty;
        set => SetField(ref _subspecialty, value);
    }

    public string SecondaryModality
    {
        get => _secondaryModality;
        set => SetField(ref _secondaryModality, value);
    }

    public string AgeGroup
    {
        get => _ageGroup;
        set => SetField(ref _ageGroup, value);
    }

    public string TopicFocus
    {
        get => _topicFocus;
        set => SetField(ref _topicFocus, value);
    }

    public string Difficulty
    {
        get => _difficulty;
        set => SetField(ref _difficulty, value);
    }

    public JsonObject ToPayload(int index, GenerationSettings settings)
    {
        var payload = new JsonObject
        {
            ["requestId"] = $"request-{index}",
            ["requestedImagesPerCase"] = settings.ImagesPerCase,
            ["includeClinicalHistory"] = settings.UseClinicalHistory,
            ["useOllamaAssist"] = settings.UseOllamaReview
        };

        if (settings.UseOllamaReview && !string.IsNullOrWhiteSpace(settings.OllamaModel))
        {
            payload["ollamaModel"] = settings.OllamaModel.Trim();
        }

        AddOptional(payload, "modality", Modality);
        AddOptional(payload, "anatomy", Anatomy);
        AddOptional(payload, "secondaryModality", SecondaryModality);
        AddOptional(payload, "ageGroup", AgeGroup);
        AddOptional(payload, "topicFocus", TopicFocus);
        AddOptional(payload, "difficulty", Difficulty);

        if (Mode == AppOptions.RequestModes[2])
        {
            var (casePath, rawInput) = NormalizeManualCasePath(Query);
            payload["requestMode"] = "manual";
            payload["selectedCasePath"] = casePath;
            payload["rawInput"] = rawInput;
            payload["diagnosis"] = TitleFromCasePath(casePath);
            payload["selectedCaseTitle"] = TitleFromCasePath(casePath);
            return payload;
        }

        if (Mode == AppOptions.RequestModes[1])
        {
            payload["requestMode"] = "random";
            payload["randomCount"] = Count;
            payload["randomDiversity"] = Subspecialty == "Mixed" ? "mixed" : "";
            payload["rawInput"] = string.IsNullOrWhiteSpace(Query) ? "Random" : Query.Trim();

            var (systems, systemMode) = AppOptions.SystemsForSubspecialty(Subspecialty);
            if (systems.Length > 0)
            {
                payload["randomSystems"] = new JsonArray(systems.Select(system => JsonValue.Create(system)).ToArray());
                payload["randomSystemMode"] = systemMode;
            }

            if (!string.IsNullOrWhiteSpace(Query) && !Query.Trim().Equals("random", StringComparison.OrdinalIgnoreCase))
            {
                payload["randomQuery"] = Query.Trim();
            }
            return payload;
        }

        payload["requestMode"] = "specific";
        payload["diagnosis"] = Query.Trim();
        payload["rawInput"] = Query.Trim();
        return payload;
    }

    private static void AddOptional(JsonObject payload, string name, string value)
    {
        if (!string.IsNullOrWhiteSpace(value) && !value.Equals("Any", StringComparison.OrdinalIgnoreCase))
        {
            payload[name] = value.Trim();
        }
    }

    private static (string CasePath, string RawInput) NormalizeManualCasePath(string value)
    {
        var text = (value ?? "").Trim();
        if (text.StartsWith("/cases/", StringComparison.OrdinalIgnoreCase))
        {
            return (text, text);
        }

        var match = Regex.Match(text, @"(?:https?://radiopaedia\.org)?(/cases/[^?\s]+)", RegexOptions.IgnoreCase);
        if (match.Success)
        {
            return (match.Groups[1].Value, text);
        }

        return (text, text);
    }

    private static string TitleFromCasePath(string casePath)
    {
        var slug = (casePath ?? "").Split("/cases/", StringSplitOptions.None).LastOrDefault() ?? "";
        slug = slug.Split('?')[0];
        slug = Regex.Replace(slug, @"-\d+$", "");
        return Regex.Replace(slug.Replace("-", " "), @"\s+", " ").Trim();
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
