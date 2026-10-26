# Another Hero · 웹 버전

Unity 프로젝트를 브라우저 게임으로 옮긴 것. 화면(UI)은 `github업로드용/index.html` 시안을 그대로 쓰고, 게임 규칙은 Unity 스크립트를 이식함.

## 실행
`index.html` 을 브라우저로 열면 됨 (GitHub Pages에 이 폴더째 올려도 동작). 진행은 브라우저 localStorage 에 저장.

## 파일
| 파일 | 역할 |
|---|---|
| `index.html` | **자동 생성** — 시안 HTML + 규칙 패치 몇 줄 + 아래 파일 연결 |
| `game.js` | 이식한 게임 로직 (BattleManager·BattleUnit·BattleUnitView, 재화, 성장, 모집, 스토리 우편, 오프라인 보상, 저장) |
| `game.css` | 전투 화면 스타일 |
| `data.js` | **자동 생성** — `Assets/Data/Battle` 의 캐릭터·스킬·몬스터·지역·스테이지 수치 |
| `assets/monsters/` | **자동 생성** — 몬스터 스프라이트 시트 |
| `build.py`, `extract_unity.py` | 다시 빌드하는 스크립트 |

## 다시 빌드 (Unity 데이터나 시안을 고친 뒤)
```
python build.py "C:\Users\Leejian\Desktop\졸작\github업로드용\index.html"
```

## Unity 와 다르게 정한 것
- **HARD 난이도**: Unity 에는 없어서 웹에서 정함 — 몬스터 체력·공격 ×2, 방어 ×1.5, 골드·파편·경험치 ×2 (`game.js` 의 `R.hard`)
- 걸어 들어오는 몬스터는 공격받지 않음 (웹 화면이 넓어 화면 밖에서 죽는 문제)
- 로비의 전투 속도 버튼 ×1 / ×2 / ×4 (Unity 의 battleSpeed 테스트 값)
- 스킬 이름·설명과 성격 키워드는 시안(사용자 확정) 이름, 스킬 효과·쿨타임은 Unity 값
