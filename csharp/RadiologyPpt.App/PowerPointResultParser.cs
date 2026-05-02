using System.Text.RegularExpressions;

namespace RadiologyPpt.App;

public static class PowerPointResultParser
{
    public static string ExtractOutputPath(string stdout)
    {
        var match = Regex.Match(stdout, @"Created PowerPoint:\s*(.+)", RegexOptions.IgnoreCase);
        return match.Success ? match.Groups[1].Value.Trim() : "";
    }

    public static string ExtractManifestPath(string stdout)
    {
        var match = Regex.Match(stdout, @"Created manifest:\s*(.+)", RegexOptions.IgnoreCase);
        return match.Success ? match.Groups[1].Value.Trim() : "";
    }
}
