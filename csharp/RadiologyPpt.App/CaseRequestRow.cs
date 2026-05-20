using System.ComponentModel;
using System.IO;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace RadiologyPpt.App;

public sealed class CaseRequestRow : INotifyPropertyChanged, IDataErrorInfo
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

    public string Error => ValidationMessage;

    public string this[string columnName] => columnName == nameof(Query) ? ValidationMessage : "";

    public string Mode
    {
        get => _mode;
        set
        {
            if (SetField(ref _mode, value))
            {
                NotifyEntryStateChanged();
            }
        }
    }

    public string Query
    {
        get => _query;
        set
        {
            if (SetField(ref _query, value))
            {
                NotifyEntryStateChanged();
            }
        }
    }

    public string EntryHelpText => Mode switch
    {
        var mode when mode == AppOptions.RequestModes[2] => "Paste one exact Radiopaedia case URL or /cases/... path. Do not paste report text, PDFs, Word files, or PowerPoint files here.",
        var mode when mode == AppOptions.RequestModes[1] => "Optional Radiopaedia search terms for random cases. Leave blank for broad random pulls; use How many for the number of cases.",
        _ => "Enter a diagnosis or concise search phrase for Radiopaedia. Use Manual Case URL for exact links; use Core Review Import Sources for PDFs, Word, PowerPoint, report text, or JSON."
    };

    public string EntryExampleText => Mode switch
    {
        var mode when mode == AppOptions.RequestModes[2] => "Example: https://radiopaedia.org/cases/appendicitis-23",
        var mode when mode == AppOptions.RequestModes[1] => "Example: appendicitis, trauma, MSK, or leave blank for broad random",
        _ => "Example: glioblastoma, pediatric elbow fracture, or pulmonary embolism"
    };

    public string ValidationMessage
    {
        get
        {
            var text = (Query ?? "").Trim();
            if (Mode == AppOptions.RequestModes[2])
            {
                if (string.IsNullOrWhiteSpace(text))
                {
                    return "Manual Case URL rows need a Radiopaedia case URL or /cases/... path.";
                }

                if (!IsRadiopaediaCaseInput(text))
                {
                    return "Manual Case URL rows only accept radiopaedia.org/cases/... URLs or /cases/... paths. Put PDFs, Word, PowerPoint, report text, and JSON sources in Core Review Import Sources.";
                }
            }

            if (Mode == AppOptions.RequestModes[0] && string.IsNullOrWhiteSpace(text))
            {
                return "Specific Diagnosis rows need a diagnosis or concise Radiopaedia search phrase.";
            }

            if (Mode == AppOptions.RequestModes[0] && LooksLikeRadiopaediaCaseReference(text))
            {
                return "Switch Type to Manual Case URL when entering an exact Radiopaedia case link.";
            }

            if ((Mode == AppOptions.RequestModes[0] || Mode == AppOptions.RequestModes[1]) && LooksLikeCoreReviewSource(text))
            {
                return "This looks like source material. Put PDFs, Word files, PowerPoint decks, report text, and JSON libraries in Core Review Import Sources.";
            }

            return "";
        }
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

    public static bool IsRadiopaediaCaseInput(string value)
    {
        return TryNormalizeManualCasePath(value, out _, out _);
    }

    public static bool TryNormalizeManualCasePath(string value, out string casePath, out string rawInput)
    {
        var text = (value ?? "").Trim();
        rawInput = text;
        casePath = "";
        if (text.StartsWith("/cases/", StringComparison.OrdinalIgnoreCase))
        {
            casePath = text.Split('?')[0];
            return casePath.Length > "/cases/".Length;
        }

        var match = Regex.Match(text, @"^https?://(?:www\.)?radiopaedia\.org(/cases/[^?\s#]+)(?:[?#]\S*)?$", RegexOptions.IgnoreCase);
        if (match.Success)
        {
            casePath = match.Groups[1].Value;
            return casePath.Length > "/cases/".Length;
        }

        return false;
    }

    private static (string CasePath, string RawInput) NormalizeManualCasePath(string value)
    {
        return TryNormalizeManualCasePath(value, out var casePath, out var rawInput)
            ? (casePath, rawInput)
            : ((value ?? "").Trim(), (value ?? "").Trim());
    }

    private static bool LooksLikeRadiopaediaCaseReference(string value)
    {
        var text = (value ?? "").Trim();
        return text.Contains("radiopaedia.org/cases/", StringComparison.OrdinalIgnoreCase)
            || text.StartsWith("/cases/", StringComparison.OrdinalIgnoreCase);
    }

    private static bool LooksLikeCoreReviewSource(string value)
    {
        var text = (value ?? "").Trim();
        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        var extension = Path.GetExtension(text.Trim('"'));
        if (extension.Equals(".pdf", StringComparison.OrdinalIgnoreCase) ||
            extension.Equals(".doc", StringComparison.OrdinalIgnoreCase) ||
            extension.Equals(".docx", StringComparison.OrdinalIgnoreCase) ||
            extension.Equals(".ppt", StringComparison.OrdinalIgnoreCase) ||
            extension.Equals(".pptx", StringComparison.OrdinalIgnoreCase) ||
            extension.Equals(".txt", StringComparison.OrdinalIgnoreCase) ||
            extension.Equals(".md", StringComparison.OrdinalIgnoreCase) ||
            extension.Equals(".json", StringComparison.OrdinalIgnoreCase) ||
            extension.Equals(".jsonl", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return text.Contains("report text", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("findings:", StringComparison.OrdinalIgnoreCase) ||
            text.Contains("impression:", StringComparison.OrdinalIgnoreCase);
    }

    private static string TitleFromCasePath(string casePath)
    {
        var slug = (casePath ?? "").Split("/cases/", StringSplitOptions.None).LastOrDefault() ?? "";
        slug = slug.Split('?')[0];
        slug = Regex.Replace(slug, @"-\d+$", "");
        return Regex.Replace(slug.Replace("-", " "), @"\s+", " ").Trim();
    }

    private bool SetField<T>(ref T field, T value, [CallerMemberName] string? propertyName = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        return true;
    }

    private void NotifyEntryStateChanged()
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(EntryHelpText)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(EntryExampleText)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(ValidationMessage)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Error)));
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs("Item[]"));
    }
}
