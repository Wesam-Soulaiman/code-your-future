# Entity Generation Spec

Fill in ALL fields below. Leave no field empty — if unknown, write "ASK".
When ready, tell Claude: "generate from GENERATE.md"

## Entity

| Field | Value |
|---|---|
| Name (PascalCase singular) | |
| Plural (camelCase) | |
| Description | |

## Fields

> Delete example rows before generating. Add one row per actual field.

| Name | Parse Type | Required | Constraints | Notes |
|---|---|---|---|---|
| | String | Yes | | |
| | Number | No | min: 0 | |
| | Pointer → TargetModel | Yes | | |
| | Date | No | | |
| | String (enum) | Yes | values: draft, published | |
| | Boolean | No | | |
| | Array → TargetModel | No | | |
| | File (IMG) | No | | |

## Permissions

| Action | Roles |
|---|---|
| Create | SuperAdmin, Employee |
| Update | SuperAdmin, Employee |
| Delete | SuperAdmin |

## Instance ACL

| Setting | Value |
|---|---|
| Needed? | No |
| Read roles | |
| Write roles | |

## UI

| Setting | Value |
|---|---|
| Add/Edit mode | route |
| Icon (Font Awesome) | fa-solid fa- |
| Sidebar placement | top-level |
| Sidebar parent group | |

## Translations — English

| Key | Value |
|---|---|
| Entity title | |
| Add button | |
| Edit label | |
| Search hint | |
| Field: {fieldName} | |

## Translations — Arabic

| Key | Value |
|---|---|
| Entity title | |
| Add button | |
| Edit label | |
| Search hint | |
| Field: {fieldName} | |

## Notes

Any special behavior, computed fields, or business rules:
-
