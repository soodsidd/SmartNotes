## Disposable repository after the run

```
$ git -C worktree log --oneline
c6f5eaf SN-409 live: companion commit
fa146ee Manual SN-409 companion commit
58e1837 initial
$ git -C worktree status --short --branch
## av/sn-409-manual...origin/av/sn-409-manual
 M owner.txt
$ git -C remote.git log --oneline av/sn-409-manual   # disposable bare remote
c6f5eaf SN-409 live: companion commit
fa146ee Manual SN-409 companion commit
58e1837 initial
$ git -C worktree show --stat --format=%s HEAD
SN-409 live: companion commit

 notes.md | 1 +
 1 file changed, 1 insertion(+)
```
