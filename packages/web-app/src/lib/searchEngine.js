const CATEGORY_BOOST = {
  entity: 120,
  field: 95,
  tag: 72,
  description: 60,
  glossary: 52,
};

const VALID_OPERATORS = new Set([
  "type",
  "category",
  "schema",
  "tag",
  "entity",
  "table",
  "field",
  "owner",
]);

const TYPE_ALIASES = {
  table: "entity",
  tables: "entity",
  entities: "entity",
  columns: "field",
  column: "field",
  glossary_term: "glossary",
};

function normalize(value) {
  if (value == null) return "";
  return String(value)
    .normalize("NFKD")
    .replace(/[^\w\s@.:-]/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function toWords(value) {
  const text = normalize(value);
  return text.match(/[a-z0-9_]+/g) || [];
}

function safeText(value) {
  if (value == null) return "";
  return typeof value === "string" ? value : String(value);
}

function parseQuery(query) {
  const filters = {};
  const positiveTokens = [];
  const positivePhrases = [];
  const negativeTokens = [];
  const negativePhrases = [];

  const parts = String(query || "").match(/-?"[^"]+"|-?\S+/g) || [];
  for (const rawPart of parts) {
    let part = rawPart.trim();
    if (!part) continue;

    const negative = part.startsWith("-");
    if (negative) part = part.slice(1);

    const quoted = part.startsWith("\"") && part.endsWith("\"") && part.length >= 2;
    const unquoted = quoted ? part.slice(1, -1).trim() : part;
    const normalized = normalize(unquoted);
    if (!normalized) continue;

    if (!quoted && normalized.includes(":")) {
      const splitAt = normalized.indexOf(":");
      const op = normalized.slice(0, splitAt).trim();
      const value = normalized.slice(splitAt + 1).trim();
      if (VALID_OPERATORS.has(op) && value) {
        if (negative) {
          negativeTokens.push(value);
        } else {
          if (!filters[op]) filters[op] = [];
          filters[op].push(value);
        }
        continue;
      }
    }

    const isPhrase = quoted || normalized.includes(" ");
    if (negative) {
      if (isPhrase) negativePhrases.push(normalized);
      else negativeTokens.push(normalized);
    } else {
      if (isPhrase) positivePhrases.push(normalized);
      else positiveTokens.push(normalized);
    }
  }

  return {
    filters,
    positiveTokens,
    positivePhrases,
    negativeTokens,
    negativePhrases,
  };
}

function hasArrayMatch(values, expected) {
  if (!expected || expected.length === 0) return true;
  const normalizedValues = values.map((v) => normalize(v)).filter(Boolean);
  return expected.some((needle) => normalizedValues.some((candidate) => candidate.includes(needle)));
}

function appliesOperatorFilters(item, filters) {
  const normalizedType = TYPE_ALIASES[item.category] || item.category;
  if (!hasArrayMatch([normalizedType], filters.type || [])) return false;
  if (!hasArrayMatch([item.category], filters.category || [])) return false;
  if (!hasArrayMatch([item.schema], filters.schema || [])) return false;
  if (!hasArrayMatch(item.tags || [], filters.tag || [])) return false;
  if (!hasArrayMatch([item.entityName], (filters.entity || []).concat(filters.table || []))) return false;
  if (!hasArrayMatch([item.fieldName], filters.field || [])) return false;
  if (!hasArrayMatch([item.owner], filters.owner || [])) return false;
  return true;
}

function countTokenStartsWith(words, token) {
  let count = 0;
  for (const word of words) {
    if (word.startsWith(token)) count++;
  }
  return count;
}

function uniqueBy(list, keyFn) {
  const seen = new Set();
  const output = [];
  for (const item of list) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function normalizeCategory(category) {
  return TYPE_ALIASES[normalize(category)] || normalize(category);
}

export function buildSearchIndex(model, relationshipCounts = {}) {
  if (!model) return [];
  const items = [];
  let seq = 0;

  const entities = Array.isArray(model.entities) ? model.entities : [];
  for (const entity of entities) {
    const entityName = safeText(entity.name).trim();
    if (!entityName) continue;
    const schema = safeText(entity.subject_area || entity.schema || "");
    const tags = Array.isArray(entity.tags) ? entity.tags.map((t) => safeText(t)) : [];
    const owner = safeText(entity.owner || "");
    const popularity = Number(relationshipCounts?.[entityName] || 0);

    const baseMeta = {
      entityName,
      schema,
      tags,
      owner,
      popularity,
      modelLink: `model://entity/${entityName}`,
    };

    items.push({
      id: `search-${seq++}`,
      category: "entity",
      text: entityName,
      detail: `${safeText(entity.type || "table")} • ${(entity.fields || []).length} fields`,
      subDetail: schema || owner || "",
      fieldName: "",
      ...baseMeta,
    });

    if (entity.description) {
      items.push({
        id: `search-${seq++}`,
        category: "description",
        text: safeText(entity.description),
        detail: `Description of ${entityName}`,
        subDetail: schema || "",
        fieldName: "",
        ...baseMeta,
      });
    }

    for (const tag of tags) {
      const cleanTag = safeText(tag).trim();
      if (!cleanTag) continue;
      items.push({
        id: `search-${seq++}`,
        category: "tag",
        text: cleanTag,
        detail: `Tag on ${entityName}`,
        subDetail: schema || "",
        fieldName: "",
        ...baseMeta,
      });
    }

    const fields = Array.isArray(entity.fields) ? entity.fields : [];
    for (const field of fields) {
      const fieldName = safeText(field.name).trim();
      if (!fieldName) continue;
      const flags = [
        field.primary_key && "PK",
        field.unique && "UQ",
        field.foreign_key && "FK",
        field.nullable === false && "NN",
        field.sensitivity && safeText(field.sensitivity),
      ].filter(Boolean).join(" • ");
      items.push({
        id: `search-${seq++}`,
        category: "field",
        text: `${entityName}.${fieldName}`,
        detail: `${safeText(field.type || "unknown")} field in ${entityName}`,
        subDetail: flags || schema || "",
        fieldName,
        ...baseMeta,
      });

      if (field.description) {
        items.push({
          id: `search-${seq++}`,
          category: "description",
          text: safeText(field.description),
          detail: `Description of ${entityName}.${fieldName}`,
          subDetail: schema || "",
          fieldName,
          ...baseMeta,
        });
      }
    }
  }

  const glossary = Array.isArray(model.glossary) ? model.glossary : [];
  for (const term of glossary) {
    const termName = safeText(term.term || term.name || "").trim();
    if (!termName) continue;
    const definition = safeText(term.definition || "");
    items.push({
      id: `search-${seq++}`,
      category: "glossary",
      text: termName,
      detail: definition || "Glossary term",
      subDetail: "",
      entityName: "",
      fieldName: "",
      schema: "",
      tags: [],
      owner: "",
      popularity: 0,
      modelLink: `model://glossary/${termName}`,
    });
  }

  return items.map((item) => {
    const searchCorpus = [
      item.text,
      item.detail,
      item.subDetail,
      item.entityName,
      item.fieldName,
      item.schema,
      item.owner,
      ...(item.tags || []),
    ].join(" ");
    const searchNormalized = normalize(searchCorpus);
    const words = uniqueBy(toWords(searchNormalized), (w) => w);
    return {
      ...item,
      category: normalizeCategory(item.category),
      textNormalized: normalize(item.text),
      detailNormalized: normalize(item.detail),
      entityNormalized: normalize(item.entityName),
      fieldNormalized: normalize(item.fieldName),
      schemaNormalized: normalize(item.schema),
      ownerNormalized: normalize(item.owner),
      tagsNormalized: (item.tags || []).map((t) => normalize(t)).filter(Boolean),
      searchNormalized,
      words,
      wordSet: new Set(words),
    };
  });
}

export function rankSearchResults(index, query, limit = 160) {
  const parsed = parseQuery(query);
  const freeTextQuery = normalize(
    [...parsed.positivePhrases, ...parsed.positiveTokens].join(" ")
  );
  const hasPositiveTerms =
    parsed.positiveTokens.length > 0 || parsed.positivePhrases.length > 0;
  const hasIntent =
    freeTextQuery.length > 0 ||
    Object.keys(parsed.filters).length > 0 ||
    parsed.positiveTokens.length > 0 ||
    parsed.positivePhrases.length > 0 ||
    parsed.negativeTokens.length > 0 ||
    parsed.negativePhrases.length > 0;

  if (!hasIntent) {
    return { results: [], parsed };
  }

  const scored = [];
  for (const item of index) {
    if (!appliesOperatorFilters(item, parsed.filters)) continue;

    let excluded = false;
    for (const token of parsed.negativeTokens) {
      if (item.searchNormalized.includes(token)) {
        excluded = true;
        break;
      }
    }
    if (excluded) continue;
    for (const phrase of parsed.negativePhrases) {
      if (item.searchNormalized.includes(phrase)) {
        excluded = true;
        break;
      }
    }
    if (excluded) continue;

    let score = CATEGORY_BOOST[item.category] || 0;
    let matched = false;

    for (const phrase of parsed.positivePhrases) {
      if (!item.searchNormalized.includes(phrase)) {
        matched = false;
        score = -1;
        break;
      }
      score += 94;
      matched = true;
      if (item.textNormalized.startsWith(phrase)) score += 32;
    }
    if (score < 0) continue;

    for (const token of parsed.positiveTokens) {
      if (item.wordSet.has(token)) {
        score += 68;
        matched = true;
        continue;
      }

      const startsWithCount = countTokenStartsWith(item.words, token);
      if (startsWithCount > 0) {
        score += 38 + Math.min(12, startsWithCount * 3);
        matched = true;
        continue;
      }

      if (item.searchNormalized.includes(token)) {
        score += 24;
        matched = true;
        continue;
      }

      matched = false;
      score = -1;
      break;
    }
    if (score < 0) continue;

    if (!hasPositiveTerms) {
      matched = true;
      score += 20;
    }

    if (freeTextQuery) {
      if (item.textNormalized === freeTextQuery) score += 280;
      if (item.entityNormalized === freeTextQuery) score += 170;
      if (item.fieldNormalized === freeTextQuery) score += 130;
      if (item.textNormalized.startsWith(freeTextQuery)) score += 144;
      else if (item.searchNormalized.startsWith(freeTextQuery)) score += 96;
      else if (item.searchNormalized.includes(freeTextQuery)) score += 44;
    }

    if (!matched && hasPositiveTerms) continue;

    score += Math.min(42, Number(item.popularity || 0) * 2);
    score -= Math.min(26, Math.floor((safeText(item.text).length || 0) / 14));

    scored.push({ ...item, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.category !== b.category) {
      return (CATEGORY_BOOST[b.category] || 0) - (CATEGORY_BOOST[a.category] || 0);
    }
    return a.text.localeCompare(b.text);
  });

  return { results: scored.slice(0, limit), parsed };
}

export function buildSearchRecommendations(model, rankedResults, rawQuery) {
  const normalizedQuery = normalize(rawQuery);
  const results = Array.isArray(rankedResults) ? rankedResults : [];
  const entities = Array.isArray(model?.entities) ? model.entities : [];

  const entityHitMap = new Map();
  for (const result of results) {
    if (!result.entityName) continue;
    const prev = entityHitMap.get(result.entityName) || { entityName: result.entityName, hits: 0, schema: result.schema || "" };
    prev.hits += 1;
    if (!prev.schema && result.schema) prev.schema = result.schema;
    entityHitMap.set(result.entityName, prev);
  }

  const entityLinks = Array.from(entityHitMap.values())
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 8)
    .map((entry) => ({
      label: entry.entityName,
      modelLink: `model://entity/${entry.entityName}`,
      entityName: entry.entityName,
      schema: entry.schema,
      hits: entry.hits,
    }));

  if (entityLinks.length === 0) {
    const fallbackEntities = entities
      .slice(0, 10)
      .map((e) => safeText(e.name))
      .filter(Boolean)
      .slice(0, 6);
    for (const name of fallbackEntities) {
      entityLinks.push({
        label: name,
        modelLink: `model://entity/${name}`,
        entityName: name,
        schema: "",
        hits: 0,
      });
    }
  }

  const suggestions = [];
  const topResult = results[0];
  if (normalizedQuery && topResult?.entityName) {
    suggestions.push(`entity:${topResult.entityName}`);
    suggestions.push(`${topResult.entityName} fields`);
  }
  if (normalizedQuery && topResult?.schema) {
    suggestions.push(`schema:${topResult.schema}`);
  }
  if (topResult?.tagsNormalized?.[0]) {
    suggestions.push(`tag:${topResult.tagsNormalized[0]}`);
  }
  if (normalizedQuery) {
    suggestions.push(`"${normalizedQuery}" type:entity`);
    suggestions.push(`${normalizedQuery} -tag:deprecated`);
  } else {
    suggestions.push("type:entity");
    suggestions.push("type:field");
    suggestions.push("tag:pii");
    suggestions.push("schema:finance");
    suggestions.push("owner:data-team@example.com");
  }

  const uniqueSuggestions = uniqueBy(
    suggestions.map((s) => s.trim()).filter(Boolean),
    (s) => s.toLowerCase()
  ).slice(0, 8);

  return {
    suggestions: uniqueSuggestions,
    entityLinks,
  };
}
