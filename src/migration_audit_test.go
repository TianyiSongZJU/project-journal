package main
import("testing";"os";"reflect";"path/filepath";"encoding/json")
func TestWorkspaceMigrationAudit(t *testing.T){
 old:=os.Getenv("JOURNAL_MIGRATION_OLD"); next:=os.Getenv("JOURNAL_MIGRATION_NEW");if old==""||next==""{t.Skip("optional local migration audit")}
 a:=&Store{dir:old};b:=&Store{dir:next};x,xr,e:=a.read();if e!=nil{t.Fatal(e)};y,yr,e:=b.read();if e!=nil{t.Fatal(e)}
 if xr!=yr||!reflect.DeepEqual(x,y){t.Fatal("formal state changed")}
 for _,store:=range []*Store{a,b}{
  paths,_:=filepath.Glob(storagePath(store.dir,"备份","*.json"));count:=0
  for _,p:=range paths {raw,e:=os.ReadFile(p);if e!=nil{t.Fatal(e)};var d diskState
   if json.Unmarshal(raw,&d)==nil&&d.StorageVersion==2{if _,e=store.readDiskBytes(raw,true);e!=nil{t.Fatalf("backup %s: %v",p,e)};count++}
  }
  t.Log("projects",len(x.Projects),"entries",len(x.Entries),"timeline days",len(x.TimelineDays),"validated partition backups",count)
 }
}
