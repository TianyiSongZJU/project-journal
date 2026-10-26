package main

import (
	"os"
	"path/filepath"
	"strings"
)

// Logical paths remain unchanged in manifests and immutable history snapshots.
// Only physical directory names change, so every historical content hash stays valid.
var storageFolders = map[string]string{
	"笔记": "notes", "时间记录": "time", "自动记录": "activity",
	"历史内容": "history-content", "备份": "backups",
	"分文件迁移前": "pre-partition-migration", "自动线索旧版": "legacy-activity", "同步副本": "sync-copies",
}

func storagePath(root string, parts ...string) string {
	rel := filepath.Join(parts...)
	if _, err := os.Stat(filepath.Join(root, ".english-layout")); err == nil {
		names := strings.Split(filepath.ToSlash(rel), "/")
		// Translate directories only; filenames and content-addressed snapshots are immutable.
		for i := 0; i < len(names)-1; i++ {
			if name, ok := storageFolders[names[i]]; ok {
				names[i] = name
			}
		}
		if name, ok := storageFolders[names[len(names)-1]]; ok {
			names[len(names)-1] = name
		}
		rel = filepath.FromSlash(strings.Join(names, "/"))
	}
	return filepath.Join(root, rel)
}
func logicalStoragePath(rel string) string {
	names := strings.Split(filepath.ToSlash(rel), "/")
	for i := 0; i < len(names)-1; i++ {
		for logical, physical := range storageFolders {
			if names[i] == physical {
				names[i] = logical
				break
			}
		}
	}
	// WalkDir also passes the directory itself.
	for logical, physical := range storageFolders {
		if names[len(names)-1] == physical {
			names[len(names)-1] = logical
			break
		}
	}
	return strings.Join(names, "/")
}

// Fresh installations use English physical directories. Existing installations
// keep their layout unless explicitly migrated, including partially synced data.
func ensureStorageLayout(root string) error {
	if err := os.MkdirAll(root, 0755); err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(root, "项目手记.json")); !os.IsNotExist(err) {
		return err
	}
	for logical := range storageFolders {
		if _, err := os.Stat(filepath.Join(root, logical)); err == nil {
			return nil
		}
	}
	return atomicWrite(filepath.Join(root, ".english-layout"), []byte("1\n"))
}
