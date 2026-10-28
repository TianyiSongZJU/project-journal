package main

import "testing"

func TestAppAliasesPersistAndValidate(t *testing.T) {
	store := &Store{dir: t.TempDir()}
	st, rev, err := store.read()
	if err != nil {
		t.Fatal(err)
	}
	aliases := []AppAliasGroup{{Name: "微信", Aliases: []string{"Weixin", "WeChat.exe"}}}
	st.Settings.AppAliases = &aliases
	rev, err = store.save(st, rev)
	if err != nil {
		t.Fatal(err)
	}
	got, _, err := store.read()
	if err != nil || got.Settings.AppAliases == nil || (*got.Settings.AppAliases)[0].Name != "微信" {
		t.Fatal(got.Settings.AppAliases, err)
	}
	empty := []AppAliasGroup{}
	st.Settings.AppAliases = &empty
	_, err = store.save(st, rev)
	if err != nil {
		t.Fatal(err)
	}
	got, _, err = store.read()
	if err != nil || got.Settings.AppAliases == nil || len(*got.Settings.AppAliases) != 0 {
		t.Fatal("empty aliases must disable defaults", err)
	}
	bad := []AppAliasGroup{{Name: "A", Aliases: []string{"WeChat"}}, {Name: "B", Aliases: []string{"wechat.EXE"}}}
	st.Settings.AppAliases = &bad
	if validate(st) == nil {
		t.Fatal("ambiguous cross-group alias must fail")
	}
}
