namespace RadiologyPpt.App;

public static class AppOptions
{
    public static readonly string[] RequestModes =
    [
        "Specific Diagnosis",
        "Random Case",
        "Manual Case URL"
    ];

    public static readonly string[] Modalities =
    [
        "Any", "MRI", "CT", "X-ray", "Ultrasound", "Fluoroscopy", "PET", "Nuclear Medicine", "Mammography", "Angiography"
    ];

    public static readonly string[] Anatomy =
    [
        "Any", "Brain", "Head & Neck", "Spine", "Chest", "Cardiac", "Abdomen", "Pelvis",
        "Abdomen/Pelvis", "Breast", "Shoulder", "Elbow", "Wrist/Hand", "Hip", "Knee", "Ankle/Foot", "Fetal"
    ];

    public static readonly string[] Subspecialties =
    [
        "Any", "Mixed", "Neuro", "Pediatrics", "Pediatric Neuro", "MSK", "Body", "Chest", "Cardiac",
        "Head & Neck", "Spine", "GI", "Hepatobiliary", "GU", "Breast", "Vascular", "Trauma",
        "Oncology", "Obstetrics", "Gynecology", "Hematology", "Interventional", "Forensic"
    ];

    public static readonly string[] AgeGroups = ["Any", "Adult", "Pediatric", "Neonatal"];
    public static readonly string[] TopicFocuses = ["Any", "Tumor", "Trauma", "Infection", "Vascular", "Congenital"];
    public static readonly string[] Difficulties = ["Any", "Easy", "Medium", "Hard"];
    public static readonly string[] Themes = ["Radiopaedia Classic", "Clean Light", "Conference Dark", "Teaching Warm"];
    public static readonly string[] PowerPointStyles = ["Case Conference", "Core Review"];
    public static readonly string[] CoreReviewQuestionSources =
    [
        "Bundled Free CORE Review Questions",
        "Imported Core Review Library",
        "Custom Question Bank JSON"
    ];
    public static readonly string[] CoreReviewCaseMixes =
    [
        "General Random CORE Mix",
        "Even Domain Random Mix",
        "Focused Domain Random Mix"
    ];
    public static readonly string[] CoreReviewModalityMixes =
    [
        "Mixed Modalities",
        "Prefer Classic Modality",
        "Any Modality"
    ];
    public static readonly PowerPointPreset[] PowerPointPresets =
    [
        new(
            "Fast Preview",
            "Fastest workflow: no Ollama review and no teaching slides.",
            3,
            "case-conference",
            "classic",
            UseClinicalHistory: true,
            UseOllamaReview: false,
            IncludeTeachingPoints: false),
        new(
            "Ollama Assisted",
            "Keep preparation fast, then optionally score individual cases in the review window.",
            3,
            "case-conference",
            "classic",
            UseClinicalHistory: true,
            UseOllamaReview: true,
            IncludeTeachingPoints: false),
        new(
            "Dark Conference",
            "A darker case-conference look for presenting in a reading room or lecture room.",
            3,
            "case-conference",
            "conference-dark",
            UseClinicalHistory: true,
            UseOllamaReview: false,
            IncludeTeachingPoints: false)
    ];

    public static readonly string[] BoardDomains =
    [
        "General / Mixed", "Breast Imaging", "Cardiovascular", "CT", "GI", "GU", "Interventional",
        "MRI", "MSK", "Neuro", "NIS", "Nuclear", "Pediatrics", "Physics", "RISC",
        "Radiography / Fluoroscopy", "Thoracic", "Ultrasound"
    ];

    public static (string[] Systems, string Mode) SystemsForSubspecialty(string label)
    {
        return label switch
        {
            "Neuro" => (["Central Nervous System"], "all"),
            "Pediatrics" => (["Paediatrics"], "all"),
            "Pediatric Neuro" => (["Central Nervous System", "Paediatrics"], "all"),
            "MSK" => (["Musculoskeletal"], "all"),
            "Body" => (["Chest", "Gastrointestinal", "Hepatobiliary", "Urogenital", "Gynaecology", "Obstetrics"], "any"),
            "Chest" => (["Chest"], "all"),
            "Cardiac" => (["Cardiac"], "all"),
            "Head & Neck" => (["Head & Neck"], "all"),
            "Spine" => (["Spine"], "all"),
            "GI" => (["Gastrointestinal"], "all"),
            "Hepatobiliary" => (["Hepatobiliary"], "all"),
            "GU" => (["Urogenital"], "all"),
            "Breast" => (["Breast"], "all"),
            "Vascular" => (["Vascular"], "all"),
            "Trauma" => (["Trauma"], "all"),
            "Oncology" => (["Oncology"], "all"),
            "Obstetrics" => (["Obstetrics"], "all"),
            "Gynecology" => (["Gynaecology"], "all"),
            "Hematology" => (["Haematology"], "all"),
            "Interventional" => (["Interventional"], "all"),
            "Forensic" => (["Forensic"], "all"),
            _ => ([], "all")
        };
    }

    public static string ThemeCliValue(string label) => label switch
    {
        "Clean Light" => "clean-light",
        "Conference Dark" => "conference-dark",
        "Teaching Warm" => "teaching-warm",
        _ => "classic"
    };

    public static string PowerPointStyleCliValue(string label) => label == "Core Review" ? "core-review" : "case-conference";

    public static string CoreReviewQuestionSourceCliValue(string label) => label switch
    {
        "Imported Core Review Library" => "library",
        "Custom Question Bank JSON" => "question-bank",
        _ => "bundled"
    };

    public static string BoardDomainCliValue(string label) => label switch
    {
        "Breast Imaging" => "breast",
        "Cardiovascular" => "cardiovascular",
        "CT" => "ct",
        "GI" => "gi",
        "GU" => "gu",
        "Interventional" => "ir",
        "MRI" => "mr",
        "MSK" => "msk",
        "Neuro" => "neuro",
        "NIS" => "nis",
        "Nuclear" => "nuclear",
        "Pediatrics" => "pediatric",
        "Physics" => "physics",
        "RISC" => "risc",
        "Radiography / Fluoroscopy" => "radiography_fluoroscopy",
        "Thoracic" => "thoracic",
        "Ultrasound" => "ultrasound",
        _ => ""
    };

    public static string CoreReviewCaseMixCliValue(string label) => label switch
    {
        "Even Domain Random Mix" => "even",
        "Focused Domain Random Mix" => "focused",
        "Even Domain Mix" => "even",
        "Focused Domain" => "focused",
        _ => "blueprint"
    };

    public static string CoreReviewModalityMixCliValue(string label) => label switch
    {
        "Prefer Classic Modality" => "classic",
        "Any Modality" => "any",
        _ => "mixed"
    };
}

public sealed record PowerPointPreset(
    string Name,
    string Description,
    int ImagesPerCase,
    string PowerPointStyle,
    string Theme,
    bool UseClinicalHistory,
    bool UseOllamaReview,
    bool IncludeTeachingPoints);
