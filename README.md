# 오답 변형 OX 문법 (별도 프로젝트)

이 프로젝트는 **“오답만 돌리다가, 틀린 문제는 그 자리에서 AI 변형문제로 추가 훈련”**하는 용도입니다.

- 프론트: 순수 HTML/CSS/JS (hash 라우팅)
- 데이터: LocalStorage 저장
- AI: Vercel Functions(`/api/variants`) → OpenAI API 호출 (브라우저에 키 저장하지 않음)

## 배포 (GitHub + Vercel)

1) 이 폴더를 **새 GitHub 레포**로 업로드  
2) Vercel에서 **Import Project** (Framework: Other / Static)  
3) Vercel 환경변수 추가

- `OPENAI_API_KEY` = OpenAI API Key
- (선택) `OPENAI_MODEL` = 기본은 `gpt-4o-mini`

4) Deploy

## 사용 방법

1. 카테고리(덱) 만들기
2. 문제 추가 또는 JSON 가져오기
3. 학습을 돌려서 오답을 만들기
4. **오답을 선택해서 틀리면** “AI 변형 n개 풀기” 버튼이 나타남
5. 누르면 즉시 변형문제가 생성되고, 그 변형문제만 바로 풀 수 있음

## JSON 가져오기 형식

아래처럼 배열이면 됩니다.

```json
[
  {"prompt":"If I were you, I would accept the offer.","answer":"O","explanation":"가정법 현재: If+과거, would+동사원형","tags":["가정법"]},
  {"prompt":"If I was you, I would accept the offer.","answer":"X","explanation":"가정법에서는 were 사용","tags":["가정법"]}
]
```

## 주의

- AI 출력은 100% 완벽하진 않을 수 있어요. 이상하면 카드 편집으로 수정하세요.
- AI는 네트워크/요금이 발생할 수 있습니다.

## 샘플 데이터

- `sample-data/starter-cards.json` : (who/whom, 가정법, Only 도치, 분사) 기본 세트
- `sample-data/ox-grammar-extra-cards.json` : 이전에 정리된 추가 카드 묶음

앱에서 **가져오기**로 넣으면 됩니다.


## v2 patch
- Fixed modal close on iOS/Safari by enforcing `[hidden]` display none and bumping service worker cache.
