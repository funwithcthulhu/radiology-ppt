import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const CONTRACT_DIR = path.resolve("src", "contracts");
const SCHEMA_NAMES = [
  "case-request.schema.json",
  "image-candidate.schema.json",
  "prepare-input.schema.json",
  "prepared-output.schema.json",
  "render-input.schema.json",
];

function loadSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(CONTRACT_DIR, name), "utf8"));
}

const schemas = Object.fromEntries(SCHEMA_NAMES.map((name) => [name, loadSchema(name)]));

function resolveReference(reference, rootSchema) {
  if (reference.startsWith("#/")) {
    const resolved = reference
      .slice(2)
      .split("/")
      .reduce((node, part) => node?.[part], rootSchema);
    if (!resolved) {
      throw new Error(`Unknown schema reference: ${reference}`);
    }
    return resolved;
  }

  const schemaName = reference.replace(/^.*\//, "");
  const schema = schemas[schemaName];
  if (!schema) {
    throw new Error(`Unknown schema reference: ${reference}`);
  }
  return schema;
}

function validate(schema, value, location = "$", rootSchema = schema) {
  if (schema.$ref) {
    return validate(resolveReference(schema.$ref, rootSchema), value, location, rootSchema);
  }

  if (schema.anyOf) {
    const errors = [];
    for (const option of schema.anyOf) {
      try {
        validate(option, value, location, rootSchema);
        return;
      } catch (error) {
        errors.push(error.message);
      }
    }
    throw new Error(`${location} failed anyOf: ${errors.join("; ")}`);
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(type, value))) {
      throw new Error(`${location} expected ${types.join("|")} but got ${Array.isArray(value) ? "array" : typeof value}`);
    }
  }

  if (typeof value === "string" && schema.minLength && value.length < schema.minLength) {
    throw new Error(`${location} must be at least ${schema.minLength} characters`);
  }

  if (Number.isInteger(value) && Number.isInteger(schema.minimum) && value < schema.minimum) {
    throw new Error(`${location} must be >= ${schema.minimum}`);
  }

  if (Number.isInteger(value) && Number.isInteger(schema.maximum) && value > schema.maximum) {
    throw new Error(`${location} must be <= ${schema.maximum}`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    throw new Error(`${location} must be one of ${schema.enum.join(", ")}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems && value.length < schema.minItems) {
      throw new Error(`${location} must include at least ${schema.minItems} item(s)`);
    }
    if (schema.items) {
      value.forEach((item, index) => validate(schema.items, item, `${location}[${index}]`, rootSchema));
    }
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const required of schema.required ?? []) {
      if (!(required in value)) {
        throw new Error(`${location}.${required} is required`);
      }
    }
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (key in value) {
        validate(propertySchema, value[key], `${location}.${key}`, rootSchema);
      }
    }
  }
}

function matchesType(type, value) {
  if (type === "array") {
    return Array.isArray(value);
  }
  if (type === "integer") {
    return Number.isInteger(value);
  }
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (type === "object") {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  if (type === "null") {
    return value === null;
  }
  return typeof value === type;
}

const request = {
  requestId: "request-1",
  requestMode: "specific",
  rawInput: "multiple sclerosis, mri brain",
  diagnosis: "multiple sclerosis",
  modality: "MRI",
  anatomy: "Brain",
  requestedImagesPerCase: 3,
  includeClinicalHistory: true,
  useOllamaAssist: false,
};

const image = {
  url: "https://images.radiopaedia.org/images/1/example.jpg",
  localPath: "cache/images/example.jpg",
  label: "MRI brain",
  frameId: "123",
  modality: "MRI",
  relevantScore: 240,
  isAnnotated: true,
  isKeyImage: false,
  isCurrent: true,
  focusPoints: [{ x: 0.4, y: 0.5, kind: "arrow" }],
};

const preparedOutput = {
  entries: [request],
  items: [
    {
      request,
      caseData: {
        caseTitle: "Multiple sclerosis",
        casePath: "/cases/multiple-sclerosis-1?lang=us",
        caseUrl: "https://radiopaedia.org/cases/multiple-sclerosis-1?lang=us",
        caseIntro: "Adult patient.",
        modalitySummary: "MRI",
        quality: { summary: "3 relevant images selected." },
        images: [image],
        imageCandidateBank: [image],
      },
    },
  ],
  failures: [],
};

test("contract schemas load with stable ids", () => {
  for (const [name, schema] of Object.entries(schemas)) {
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema", name);
    assert.match(schema.$id, /radiology-ppt/);
  }
});

test("prepare input schema accepts C# request payloads", () => {
  validate(schemas["prepare-input.schema.json"], [request]);
  validate(schemas["prepare-input.schema.json"], ["appendicitis, ct abdomen"]);
  validate(schemas["prepare-input.schema.json"], {
    entries: [request],
    args: {
      imagesPerCase: 3,
      useClinicalHistory: true,
      useOllamaAssist: false,
      ollamaModel: "",
      onlyNewRandomCases: true,
    },
  });
});

test("prepared output and render input schemas accept backend payloads", () => {
  validate(schemas["prepared-output.schema.json"], preparedOutput);
  validate(schemas["render-input.schema.json"], {
    items: preparedOutput.items,
    args: {
      deckMode: "core-review",
      coreReviewQuestionSource: "library",
      coreReviewQuestionBankPath: "C:\\core-review-bank.json",
      theme: "teaching-warm",
      title: "Core Review Test",
      out: "C:\\deck.pptx",
      includeTeachingPoints: true,
    },
  });
});

test("prepared output schema rejects missing case data", () => {
  assert.throws(
    () => validate(schemas["prepared-output.schema.json"], { entries: [request], items: [{ request }], failures: [] }),
    /caseData is required/,
  );
});

test("contracts reject empty and out-of-range GUI payloads", () => {
  assert.throws(
    () => validate(schemas["prepare-input.schema.json"], []),
    /must include at least 1 item/,
  );
  assert.throws(
    () => validate(schemas["prepare-input.schema.json"], {
      entries: [
        {
          ...request,
          requestMode: "random",
          randomCount: 21,
        },
      ],
    }),
    /randomCount must be <= 20/,
  );
  assert.throws(
    () => validate(schemas["prepare-input.schema.json"], {
      entries: [
        {
          ...request,
          requestMode: "surprise-me",
        },
      ],
    }),
    /requestMode must be one of/,
  );
  assert.throws(
    () => validate(schemas["render-input.schema.json"], { items: [] }),
    /must include at least 1 item/,
  );
});
