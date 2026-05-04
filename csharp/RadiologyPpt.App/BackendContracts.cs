using System.Text.Json.Nodes;

namespace RadiologyPpt.App;

public static class BackendPayloads
{
    public static JsonObject Prepare(IEnumerable<JsonObject> entries, GenerationSettings settings)
    {
        return new JsonObject
        {
            ["entries"] = new JsonArray(entries.Select(entry => entry.DeepClone()).ToArray()),
            ["args"] = PrepareArgs(settings)
        };
    }

    public static JsonObject ScoreImages(JsonObject item, GenerationSettings settings)
    {
        return new JsonObject
        {
            ["item"] = item.DeepClone(),
            ["args"] = new JsonObject
            {
                ["ollamaModel"] = settings.OllamaModel
            }
        };
    }

    public static JsonObject Render(IEnumerable<JsonObject> approvedItems, GenerationSettings settings)
    {
        return new JsonObject
        {
            ["items"] = new JsonArray(approvedItems.Select(item => item.DeepClone()).ToArray()),
            ["args"] = new JsonObject
            {
                ["deckMode"] = settings.PowerPointStyle,
                ["theme"] = settings.Theme,
                ["title"] = settings.Title,
                ["out"] = settings.OutputPath,
                ["includeTeachingPoints"] = settings.IncludeTeachingPoints
            }
        };
    }

    public static JsonObject CoreReviewPdfImport(IEnumerable<string> pdfPaths, string domain, string outputPath)
    {
        return new JsonObject
        {
            ["inputPaths"] = new JsonArray(pdfPaths.Select(path => JsonValue.Create(path)).ToArray()),
            ["args"] = new JsonObject
            {
                ["out"] = outputPath,
                ["format"] = "json",
                ["domain"] = domain
            }
        };
    }

    public static JsonObject Empty() => new();

    private static JsonObject PrepareArgs(GenerationSettings settings)
    {
        return new JsonObject
        {
            ["imagesPerCase"] = settings.ImagesPerCase,
            ["useClinicalHistory"] = settings.UseClinicalHistory,
            ["useOllamaAssist"] = settings.UseOllamaReview,
            ["ollamaModel"] = settings.OllamaModel,
            ["onlyNewRandomCases"] = settings.OnlyNewRandomCases
        };
    }
}

public static class BackendPayloadReader
{
    public static List<JsonObject> ReadPreparedItems(JsonObject prepared)
    {
        return prepared["items"]?.AsArray()
            .Select(node => node?.DeepClone().AsObject())
            .Where(item => item is not null)
            .Cast<JsonObject>()
            .ToList()
            ?? [];
    }

    public static string[] ReadFailures(JsonObject prepared)
    {
        return prepared["failures"]?.AsArray()
            .Select(node => node?.GetValue<string>() ?? "")
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .ToArray()
            ?? [];
    }

    public static string TextValue(JsonObject? node, string name, string fallback = "")
    {
        if (node is null || node[name] is null)
        {
            return fallback;
        }

        try
        {
            return node[name]!.ToString();
        }
        catch
        {
            return fallback;
        }
    }
}
