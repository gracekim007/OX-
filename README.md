# OX 문법 (PWA)

Vocat에서 하던 방식(문장 → O/X → 설명)을 전용 앱으로 만든 오프라인 PWA입니다.

## 실행(PC)

1) 폴더에서 터미널 열기
2) 아래 중 하나 실행

### Python

```bash
python -m http.server 8000
```

브라우저에서 `http://localhost:8000/` 접속

### Node

```bash
npx serve -l 8000 .
```

## 폰에 앱처럼 설치

- **Android(Chrome)**: 메뉴(⋮) → 홈 화면에 추가
- **iPhone(Safari)**: 공유(□↑) → 홈 화면에 추가

※ PWA 오프라인 기능은 https 또는 localhost 환경에서만 동작합니다.

## 문제(카드) 형식

앱의 `가져오기/내보내기`에서 아래 JSON 배열을 붙여넣으면 선택한 카테고리에 추가됩니다.

```json
[
  {
    "prompt": "think it better to tell the truth",
    "answer": "O",
    "explanation": "think + it(가목적어) + 형용사 + to V",
    "tags": ["5형식", "가목적어"]
  }
]
```

## 백업

`전체 백업 내보내기`로 JSON 저장해두면, 새 폰에서도 그대로 복원 가능합니다.
