# Contracts for DQL blocks

DataLex contracts are the bridge between a dbt model and a trusted DQL answer.
They are not a replacement for dbt model contracts, semantic metrics, or SQL.
They add the business meaning DQL needs before a block can be treated as a
certified answer.

The short version:

```text
dbt model = physical transformation and schema
semantic metric = governed formula
DataLex contract = approved business meaning, grain, owner, evidence, and allowed use
DQL block = executable answer tied to that approved meaning
```

## Why this exists

Most wrong AI analytics answers are not caused by bad SQL syntax. They happen
because the agent chooses the wrong model, wrong grain, wrong metric, or wrong
business definition.

For example, in an NBA analytics project, "top players by points" could be
answered from raw game rows, an intermediate game-stat model, a player-season
fact, or a dashboard-specific aggregate. All can produce SQL that runs. Only one
may match the business question the team wants to certify.

A DataLex contract tells DQL:

> This block is allowed to answer this class of question because it is grounded
> in a reviewed business definition, known grain, known source model, known
> owner, and explicit assumptions.

## What a contract is based on

Contracts usually start from one of four places:

| Source | Best use | Example |
|---|---|---|
| Fact table | Analytical questions and ranking/drilldown blocks | `fct_player_journey` |
| Semantic metric | Governed KPI definitions | `points_per_game`, `efficiency_rating` |
| Dimension table | Business entities and identifiers | `dim_players_cleansed` |
| Business view | Multi-model approved answer surface | `Player Performance View` |

dbt remains the source of truth for physical model behavior. If a dbt model
already has `contract.enforced: true`, DataLex imports and links to it. If the
dbt model has no enforced contract, DataLex can propose a draft contract from
the model SQL, YAML docs, tests, semantic metrics, exposures, and repeated DQL
usage.

## What the contract contains

A useful contract should answer these questions:

- What business concept does this represent?
- What is the exact row grain?
- Which measures and dimensions are approved?
- Which dbt model or semantic metric is the source?
- Who owns the definition?
- What tests or evidence support it?
- What assumptions still need review?
- What DQL blocks are allowed to rely on it?

Example:

```yaml
kind: contract
id: basketball.PlayerSeasonPerformance.player_season_journey
name: player_season_journey
domain: basketball
entity: PlayerSeasonPerformance
version: 1
status: certified
business_definition: >
  One row per NBA player per season, used to analyze player trajectory,
  season performance, and career-to-date totals.

source:
  system: dbt
  ref: fct_player_journey

dbt_contract:
  model: fct_player_journey
  unique_id: model.nba_analysis.fct_player_journey
  enforced: false

signature:
  grain: [player_id, season]
  measures:
    - total_points
    - total_assists
    - total_rebounds
    - games_played
    - efficiency_rating
    - career_pts
  dimensions:
    - player_name
    - season
    - team_id
    - player_position

evidence:
  source_models:
    - model.nba_analysis.fct_player_journey
  upstream_models:
    - model.nba_analysis.int_season_stats
    - model.nba_analysis.stg_player_information
  tests:
    - not_null_fct_player_journey_player_id
    - not_null_fct_player_journey_season
  inferred_grain: player_id, season
  confidence: 0.86
  assumptions:
    - team_id reflects the v1 deduplication policy for multi-team seasons
  open_questions:
    - Should team_id resolve to team_name through dim_teams_cleansed?
```

## How DQL uses it

A certified DQL block references the contract by id and version:

```dql
block "top_5_players_points_2016_2017" {
  status = "certified"
  domain = "basketball"
  owner = "analytics"
  datalex_contract = "basketball.PlayerSeasonPerformance.player_season_journey@1"

  query {
    sql = """
SELECT
  player_name,
  SUM(total_points) AS total_points_2016_2017
FROM TRANSFORMED.fct_player_journey
WHERE season IN (2016, 2017)
GROUP BY player_name
ORDER BY total_points_2016_2017 DESC, player_name ASC
LIMIT 5
    """
  }
}
```

During DQL compile, the compiler loads `datalex-manifest.json` and checks that
the referenced contract exists. If the block is certified and the contract does
not resolve, the block is not safe to publish as a trusted answer.

## It should not block fast work

Enterprise projects often have hundreds of DQL blocks and thousands of dbt
models. Contracts should create trust boundaries, not stop teams from exploring.

| DQL block state | Contract required? | Can run? | Trusted answer? |
|---|---:|---:|---:|
| Draft / AI-generated | No | Yes | No, review needed |
| Reviewed | Recommended | Yes | Limited, warning |
| Certified | Yes | Yes, if contract resolves | Yes |
| Published app tile | Yes | Yes, if contract resolves | Yes |

The rule is:

> Missing contracts should block certification and trusted publish, not draft
> exploration.

That means a draft block can run while teams are still modeling. A certified
block must resolve its DataLex contract before it can be served to executives,
apps, or AI agents as trusted.

## Where the contract is used

| Place | How the contract helps |
|---|---|
| AI generation | Narrows the model, grain, measures, dimensions, and filters the agent should use |
| Review | Shows evidence, assumptions, source dbt model, tests, and open questions |
| DQL compile | Validates certified blocks against `datalex-manifest.json` |
| Runtime answers | Lets DQL label answers as certified instead of AI-generated |
| Change impact | Shows which DQL blocks are affected when a model, grain, or metric changes |
| Cloud governance | Powers review queues, owner routing, trust reports, and publish gates |

## Adoption path for existing dbt repos

Do not ask teams to contract everything first.

1. Import the dbt project.
2. Prioritize existing dbt contracts, semantic metrics, exposures, marts, and frequently used models.
3. Let AI propose draft contracts with evidence.
4. Review and certify only the high-value domains first.
5. Bind certified DQL blocks to those contracts.
6. Leave exploratory and legacy blocks as draft/reviewed until their usage justifies certification.

For a large enterprise, the first milestone is not "100 percent contracted."
The first milestone is:

> The most important agent answers and published app tiles are backed by
> certified contracts with evidence.

