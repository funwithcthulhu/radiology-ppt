namespace RadiologyPpt.App;

public sealed record GenerationSettings
{
    public string Title { get; init; } = "";
    public int ImagesPerCase { get; init; } = 3;
    public string OutputPath { get; init; } = "";
    public bool AutoOpen { get; init; } = true;
    public bool UseClinicalHistory { get; init; } = true;
    public bool UseOllamaReview { get; init; }
    public string OllamaModel { get; init; } = "";
    public string Theme { get; init; } = "classic";
    public string PowerPointStyle { get; init; } = "case-conference";
    public string CoreReviewQuestionSource { get; init; } = "bundled";
    public string CoreReviewQuestionBankPath { get; init; } = "";
    public bool IncludeTeachingPoints { get; init; }
    public bool OnlyNewRandomCases { get; init; } = true;
}

public sealed record CoreReviewDeckSettings
{
    public int CaseCount { get; init; } = 50;
    public string Domain { get; init; } = "";
    public string CaseMix { get; init; } = "blueprint";
    public string ModalityMix { get; init; } = "mixed";
    public string Seed { get; init; } = "";
    public string CaseBankPath { get; init; } = "";
}
