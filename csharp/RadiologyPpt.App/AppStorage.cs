using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace RadiologyPpt.App;

public sealed class AppStorage
{
    private readonly string _stateDir;
    private readonly string _appRoot;

    public AppStorage(string stateDir, string appRoot)
    {
        _stateDir = stateDir;
        _appRoot = appRoot;
        DatabasePath = Path.Combine(_stateDir, "radiology-ppt.sqlite");
    }

    public string DatabasePath { get; }

    public void Initialize()
    {
        Directory.CreateDirectory(_stateDir);
        using var connection = OpenConnection();
        ExecuteNonQuery(connection, "PRAGMA journal_mode=WAL;");
        ExecuteNonQuery(connection, "PRAGMA foreign_keys=ON;");
        ExecuteNonQuery(connection, SchemaSql);
        SaveMetadata("schema_version", "1");
        MigrateRandomHistoryFromJson();
    }

    public void SaveGenerationSettings(GenerationSettings settings)
    {
        SaveSetting("title", settings.Title);
        SaveSetting("images_per_case", settings.ImagesPerCase.ToString());
        SaveSetting("output_path", settings.OutputPath);
        SaveSetting("auto_open", settings.AutoOpen ? "1" : "0");
        SaveSetting("use_clinical_history", settings.UseClinicalHistory ? "1" : "0");
        SaveSetting("use_ollama_review", settings.UseOllamaReview ? "1" : "0");
        SaveSetting("ollama_model", settings.OllamaModel);
        SaveSetting("theme", settings.Theme);
        SaveSetting("powerpoint_style", settings.PowerPointStyle);
        SaveSetting("crop_mode", settings.CropMode);
        SaveSetting("markup_style", settings.MarkupStyle);
        SaveSetting("include_teaching_points", settings.IncludeTeachingPoints ? "1" : "0");
    }

    public Dictionary<string, string> LoadSettings()
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT key, value FROM app_settings;";
        using var reader = command.ExecuteReader();
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        while (reader.Read())
        {
            values[reader.GetString(0)] = reader.IsDBNull(1) ? "" : reader.GetString(1);
        }
        return values;
    }

    public string CreateReviewSession(JsonObject prepared, string requestSummary)
    {
        var sessionId = Guid.NewGuid().ToString("N");
        using (var connection = OpenConnection())
        {
            using var command = connection.CreateCommand();
            command.CommandText = """
                INSERT INTO review_sessions
                  (id, created_at, updated_at, status, request_summary, prepared_json, approved_count, exported_path)
                VALUES
                  ($id, $created_at, $updated_at, 'prepared', $request_summary, $prepared_json, 0, '');
                """;
            command.Parameters.AddWithValue("$id", sessionId);
            command.Parameters.AddWithValue("$created_at", Timestamp());
            command.Parameters.AddWithValue("$updated_at", Timestamp());
            command.Parameters.AddWithValue("$request_summary", requestSummary);
            command.Parameters.AddWithValue("$prepared_json", prepared.ToJsonString(new JsonSerializerOptions { WriteIndented = false }));
            command.ExecuteNonQuery();
        }

        foreach (var item in prepared["items"]?.AsArray() ?? [])
        {
            if (item is JsonObject itemObject)
            {
                SaveImageCandidates(itemObject["caseData"] as JsonObject);
            }
        }

        RecordEvent("info", "Prepared review session", $"{sessionId}: {requestSummary}");
        return sessionId;
    }

    public void SaveCaseReview(string sessionId, JsonObject item, string status)
    {
        var caseData = item["caseData"] as JsonObject;
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO case_reviews
              (session_id, created_at, case_path, case_title, status, item_json)
            VALUES
              ($session_id, $created_at, $case_path, $case_title, $status, $item_json);
            """;
        command.Parameters.AddWithValue("$session_id", sessionId);
        command.Parameters.AddWithValue("$created_at", Timestamp());
        command.Parameters.AddWithValue("$case_path", TextValue(caseData, "casePath"));
        command.Parameters.AddWithValue("$case_title", TextValue(caseData, "caseTitle"));
        command.Parameters.AddWithValue("$status", status);
        command.Parameters.AddWithValue("$item_json", item.ToJsonString(new JsonSerializerOptions { WriteIndented = false }));
        command.ExecuteNonQuery();
        SaveImageCandidates(caseData);
    }

    public void MarkReviewSessionExported(string sessionId, string outputPath, int approvedCount)
    {
        if (string.IsNullOrWhiteSpace(sessionId))
        {
            return;
        }

        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE review_sessions
            SET status = 'exported',
                exported_path = $exported_path,
                approved_count = $approved_count,
                updated_at = $updated_at
            WHERE id = $id;
            """;
        command.Parameters.AddWithValue("$id", sessionId);
        command.Parameters.AddWithValue("$exported_path", outputPath);
        command.Parameters.AddWithValue("$approved_count", approvedCount);
        command.Parameters.AddWithValue("$updated_at", Timestamp());
        command.ExecuteNonQuery();
    }

    public void SaveGeneratedPowerPoint(GenerationSettings settings, string outputPath, string manifestPath, int caseCount)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO generated_powerpoints
              (created_at, title, output_path, manifest_path, style, theme, case_count)
            VALUES
              ($created_at, $title, $output_path, $manifest_path, $style, $theme, $case_count);
            """;
        command.Parameters.AddWithValue("$created_at", Timestamp());
        command.Parameters.AddWithValue("$title", settings.Title);
        command.Parameters.AddWithValue("$output_path", outputPath);
        command.Parameters.AddWithValue("$manifest_path", manifestPath);
        command.Parameters.AddWithValue("$style", settings.PowerPointStyle);
        command.Parameters.AddWithValue("$theme", settings.Theme);
        command.Parameters.AddWithValue("$case_count", caseCount);
        command.ExecuteNonQuery();
        RecordEvent("info", "Created PowerPoint", outputPath);
    }

    public void SaveCoreSourceImports(IEnumerable<string> sourcePaths, string domain)
    {
        using var connection = OpenConnection();
        foreach (var sourcePath in sourcePaths)
        {
            using var command = connection.CreateCommand();
            command.CommandText = """
                INSERT INTO core_sources (imported_at, source_path, domain)
                VALUES ($imported_at, $source_path, $domain);
                """;
            command.Parameters.AddWithValue("$imported_at", Timestamp());
            command.Parameters.AddWithValue("$source_path", sourcePath);
            command.Parameters.AddWithValue("$domain", domain);
            command.ExecuteNonQuery();
        }
        RecordEvent("info", "Imported Core Boards PDFs", domain);
    }

    public void SaveImageCandidates(JsonObject? caseData)
    {
        if (caseData is null)
        {
            return;
        }

        var casePath = TextValue(caseData, "casePath");
        if (string.IsNullOrWhiteSpace(casePath))
        {
            return;
        }

        using var connection = OpenConnection();
        UpsertImages(connection, casePath, caseData["imageCandidateBank"] as JsonArray, isSelected: false);
        UpsertImages(connection, casePath, caseData["images"] as JsonArray, isSelected: true);
    }

    public void RecordEvent(string level, string message, string detail = "")
    {
        try
        {
            using var connection = OpenConnection();
            using var command = connection.CreateCommand();
            command.CommandText = """
                INSERT INTO app_events (created_at, level, message, detail)
                VALUES ($created_at, $level, $message, $detail);
                """;
            command.Parameters.AddWithValue("$created_at", Timestamp());
            command.Parameters.AddWithValue("$level", level);
            command.Parameters.AddWithValue("$message", message);
            command.Parameters.AddWithValue("$detail", detail);
            command.ExecuteNonQuery();
        }
        catch
        {
            // Logging should never break the main workflow.
        }
    }

    public StorageDiagnostics GetDiagnostics()
    {
        using var connection = OpenConnection();
        var counts = new Dictionary<string, long>(StringComparer.OrdinalIgnoreCase)
        {
            ["review_sessions"] = Count(connection, "review_sessions"),
            ["image_candidates"] = Count(connection, "image_candidates"),
            ["generated_powerpoints"] = Count(connection, "generated_powerpoints"),
            ["core_sources"] = Count(connection, "core_sources"),
            ["random_history"] = Count(connection, "random_history"),
            ["events"] = Count(connection, "app_events")
        };

        return new StorageDiagnostics(
            DatabasePath,
            File.Exists(DatabasePath) ? new FileInfo(DatabasePath).Length : 0,
            DirectorySize(Path.Combine(_appRoot, "cache")),
            DirectorySize(Path.Combine(_appRoot, "scratch")),
            DirectorySize(Path.Combine(_appRoot, "outputs")),
            counts,
            LoadRecentEvents(connection));
    }

    private void MigrateRandomHistoryFromJson()
    {
        var historyPath = Path.Combine(_appRoot, "cache", "random-history.json");
        if (!File.Exists(historyPath))
        {
            return;
        }

        try
        {
            var values = JsonSerializer.Deserialize<string[]>(File.ReadAllText(historyPath)) ?? [];
            using var connection = OpenConnection();
            foreach (var value in values.Where(value => !string.IsNullOrWhiteSpace(value)).Distinct(StringComparer.OrdinalIgnoreCase))
            {
                using var command = connection.CreateCommand();
                command.CommandText = """
                    INSERT INTO random_history (case_path, last_seen_at, source)
                    VALUES ($case_path, $last_seen_at, 'json-migration')
                    ON CONFLICT(case_path) DO UPDATE SET last_seen_at = excluded.last_seen_at;
                    """;
                command.Parameters.AddWithValue("$case_path", value);
                command.Parameters.AddWithValue("$last_seen_at", Timestamp());
                command.ExecuteNonQuery();
            }
        }
        catch (Exception exception)
        {
            RecordEvent("warning", "Could not migrate random history JSON", exception.Message);
        }
    }

    private void SaveSetting(string key, string value)
    {
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO app_settings (key, value, updated_at)
            VALUES ($key, $value, $updated_at)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
            """;
        command.Parameters.AddWithValue("$key", key);
        command.Parameters.AddWithValue("$value", value);
        command.Parameters.AddWithValue("$updated_at", Timestamp());
        command.ExecuteNonQuery();
    }

    private void SaveMetadata(string key, string value)
    {
        Directory.CreateDirectory(_stateDir);
        using var connection = OpenConnection();
        using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO app_metadata (key, value, updated_at)
            VALUES ($key, $value, $updated_at)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
            """;
        command.Parameters.AddWithValue("$key", key);
        command.Parameters.AddWithValue("$value", value);
        command.Parameters.AddWithValue("$updated_at", Timestamp());
        command.ExecuteNonQuery();
    }

    private SqliteConnection OpenConnection()
    {
        var connection = new SqliteConnection($"Data Source={DatabasePath}");
        connection.Open();
        return connection;
    }

    private static void UpsertImages(SqliteConnection connection, string casePath, JsonArray? images, bool isSelected)
    {
        foreach (var node in images ?? [])
        {
            if (node is not JsonObject image)
            {
                continue;
            }

            var frameId = TextValue(image, "frameId");
            var url = TextValue(image, "url");
            if (string.IsNullOrWhiteSpace(frameId) && string.IsNullOrWhiteSpace(url))
            {
                continue;
            }

            using var command = connection.CreateCommand();
            command.CommandText = """
                INSERT INTO image_candidates
                  (case_path, frame_id, url, local_path, label, score, is_selected, last_seen_at)
                VALUES
                  ($case_path, $frame_id, $url, $local_path, $label, $score, $is_selected, $last_seen_at)
                ON CONFLICT(case_path, frame_id, url) DO UPDATE SET
                  local_path = COALESCE(NULLIF(excluded.local_path, ''), image_candidates.local_path),
                  label = COALESCE(NULLIF(excluded.label, ''), image_candidates.label),
                  score = MAX(image_candidates.score, excluded.score),
                  is_selected = MAX(image_candidates.is_selected, excluded.is_selected),
                  last_seen_at = excluded.last_seen_at;
                """;
            command.Parameters.AddWithValue("$case_path", casePath);
            command.Parameters.AddWithValue("$frame_id", frameId);
            command.Parameters.AddWithValue("$url", url);
            command.Parameters.AddWithValue("$local_path", TextValue(image, "localPath"));
            command.Parameters.AddWithValue("$label", TextValue(image, "label"));
            command.Parameters.AddWithValue("$score", NumericValue(image, "relevantScore"));
            command.Parameters.AddWithValue("$is_selected", isSelected ? 1 : 0);
            command.Parameters.AddWithValue("$last_seen_at", Timestamp());
            command.ExecuteNonQuery();
        }
    }

    private static long Count(SqliteConnection connection, string tableName)
    {
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT COUNT(*) FROM {tableName};";
        return (long)(command.ExecuteScalar() ?? 0L);
    }

    private static List<AppEventSummary> LoadRecentEvents(SqliteConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT created_at, level, message, detail
            FROM app_events
            ORDER BY id DESC
            LIMIT 20;
            """;
        using var reader = command.ExecuteReader();
        var events = new List<AppEventSummary>();
        while (reader.Read())
        {
            events.Add(new AppEventSummary(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? "" : reader.GetString(3)));
        }
        return events;
    }

    private static long DirectorySize(string path)
    {
        if (!Directory.Exists(path))
        {
            return 0;
        }

        try
        {
            return Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories)
                .Sum(file => new FileInfo(file).Length);
        }
        catch
        {
            return 0;
        }
    }

    private static void ExecuteNonQuery(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    private static string TextValue(JsonObject? node, string name)
    {
        if (node?[name] is null)
        {
            return "";
        }

        return node[name]!.ToString();
    }

    private static double NumericValue(JsonObject node, string name)
    {
        try
        {
            return node[name]?.GetValue<double>() ?? 0;
        }
        catch
        {
            return 0;
        }
    }

    private static string Timestamp() => DateTimeOffset.UtcNow.ToString("O");

    private const string SchemaSql = """
        CREATE TABLE IF NOT EXISTS app_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            level TEXT NOT NULL,
            message TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS review_sessions (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            status TEXT NOT NULL,
            request_summary TEXT NOT NULL,
            prepared_json TEXT NOT NULL,
            approved_count INTEGER NOT NULL DEFAULT 0,
            exported_path TEXT NOT NULL DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS case_reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            case_path TEXT NOT NULL,
            case_title TEXT NOT NULL,
            status TEXT NOT NULL,
            item_json TEXT NOT NULL,
            FOREIGN KEY(session_id) REFERENCES review_sessions(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS image_candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_path TEXT NOT NULL,
            frame_id TEXT NOT NULL,
            url TEXT NOT NULL,
            local_path TEXT NOT NULL DEFAULT '',
            label TEXT NOT NULL DEFAULT '',
            score REAL NOT NULL DEFAULT 0,
            is_selected INTEGER NOT NULL DEFAULT 0,
            last_seen_at TEXT NOT NULL,
            UNIQUE(case_path, frame_id, url)
        );

        CREATE TABLE IF NOT EXISTS generated_powerpoints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            title TEXT NOT NULL,
            output_path TEXT NOT NULL,
            manifest_path TEXT NOT NULL,
            style TEXT NOT NULL,
            theme TEXT NOT NULL,
            case_count INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS core_sources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            imported_at TEXT NOT NULL,
            source_path TEXT NOT NULL,
            domain TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS random_history (
            case_path TEXT PRIMARY KEY,
            last_seen_at TEXT NOT NULL,
            source TEXT NOT NULL
        );
        """;
}

public sealed record StorageDiagnostics(
    string DatabasePath,
    long DatabaseBytes,
    long CacheBytes,
    long ScratchBytes,
    long OutputBytes,
    IReadOnlyDictionary<string, long> Counts,
    IReadOnlyList<AppEventSummary> RecentEvents);

public sealed record AppEventSummary(string CreatedAt, string Level, string Message, string Detail);
