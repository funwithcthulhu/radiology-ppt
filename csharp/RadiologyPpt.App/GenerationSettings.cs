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
