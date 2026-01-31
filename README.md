# TaskBase

An Obsidian plugin that queries files by properties and renders their checklist items as a grouped task list. Powered by [Datacore](https://github.com/blacksmithgu/datacore).

## Features

- Create `.taskbase` files to define task views
- Query files by folder and frontmatter properties
- Filter by dates, tags, and custom fields
- Tasks grouped by source file
- Toggle task completion directly from the view
- Click tasks to navigate to their source
- Auto-refresh when files change

## Requirements

- [Datacore](https://github.com/blacksmithgu/datacore) plugin must be installed and enabled

## Usage

Create a `.taskbase` file with a JSON configuration:

```json
{
  "version": 1,
  "source": {
    "folder": "Projects",
    "filters": [
      { "property": "status", "operator": "=", "value": "active" }
    ]
  },
  "view": {
    "showCompleted": false,
    "sortBy": "file",
    "sortDirection": "desc"
  }
}
```

### Configuration Options

#### Source

| Field | Description |
|-------|-------------|
| `folder` | Optional folder path to limit scope |
| `filters` | Array of property filters |

#### Filters

| Field | Description |
|-------|-------------|
| `property` | Frontmatter field or implicit property (`$tags`, `$mtime`, etc.) |
| `operator` | One of: `=`, `!=`, `<`, `<=`, `>`, `>=`, `contains` |
| `value` | Literal value, date (`2024-01-15`), keyword (`today`, `now`), or tag (`#project`) |

#### View

| Field | Description | Default |
|-------|-------------|---------|
| `showCompleted` | Include completed tasks | `false` |
| `sortBy` | Sort field (`file`, `mtime`, `ctime`, or property) | `file` |
| `sortDirection` | `asc` or `desc` | `desc` |

### Examples

**All incomplete tasks from a folder:**
```json
{
  "version": 1,
  "source": {
    "folder": "Work"
  },
  "view": {
    "showCompleted": false,
    "sortBy": "file",
    "sortDirection": "asc"
  }
}
```

**Tasks from files with a specific tag:**
```json
{
  "version": 1,
  "source": {
    "filters": [
      { "property": "$tags", "operator": "contains", "value": "#project" }
    ]
  },
  "view": {
    "showCompleted": false,
    "sortBy": "file",
    "sortDirection": "desc"
  }
}
```

**Tasks from files modified today:**
```json
{
  "version": 1,
  "source": {
    "filters": [
      { "property": "$mtime", "operator": ">=", "value": "today" }
    ]
  },
  "view": {
    "showCompleted": true,
    "sortBy": "file",
    "sortDirection": "desc"
  }
}
```

## Installation

### BRAT (Recommended for beta testing)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from Community Plugins
2. Open BRAT settings and click "Add Beta Plugin"
3. Enter: `ajgxyz/obsidian-taskbase`

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create a folder `obsidian-taskbase` in your vault's `.obsidian/plugins/` directory
3. Copy the downloaded files into the folder
4. Enable the plugin in Obsidian settings

## License

MIT
