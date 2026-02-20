// Vercel Function: /api/variants
// - Receives a base OX grammar item and returns N variant OX items (JSON)
// - Uses OpenAI Responses API with Structured Outputs (json_schema)
// Docs:
// - OpenAI API keys must NOT be exposed client-side.
// - Vercel Functions support Web-standard Request/Response handlers in /api.

type VariantReq = {
  n?: number;
  prompt: string;
  answer: "O" | "X" | string;
  explanation?: string;
  tags?: string[];
  language?: "ko" | "en" | string;
};

function json(resBody: any, init: ResponseInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  return new Response(JSON.stringify(resBody), { ...init, headers });
}

function normalizeAnswer(a: any): "O" | "X" {
  const v = String(a || "").trim().toUpperCase();
  return v === "X" ? "X" : "O";
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function safeStr(x: any, max = 9000) {
  const s = String(x ?? "").trim();
  return s.length > max ? s.slice(0, max) : s;
}

function extractOutputText(respJson: any): string | null {
  // Responses API returns: { output: [ { type: "message", content: [ { type:"output_text", text:"..." } ] } ] }
  const out = Array.isArray(respJson?.output) ? respJson.output : [];
  const msg = out.find((it: any) => it?.type === "message" && it?.role === "assistant") || out.find((it:any)=>it?.type==="message");
  const content = Array.isArray(msg?.content) ? msg.content : [];
  const txt = content.find((c: any) => c?.type === "output_text" && typeof c?.text === "string")?.text;
  return typeof txt === "string" ? txt : null;
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") return json({ ok: true });
    if (request.method !== "POST") return json({ error: "Use POST" }, { status: 405 });

    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      return json(
        { error: "OPENAI_API_KEY가 설정되지 않았습니다. (Vercel Environment Variables에 추가하세요)" },
        { status: 500 }
      );
    }

    let body: VariantReq;
    try {
      body = (await request.json()) as VariantReq;
    } catch {
      return json({ error: "Invalid JSON" }, { status: 400 });
    }

    const n = clamp(Number(body.n ?? 3) || 3, 1, 8);
    const prompt = safeStr(body.prompt, 2000);
    const answer = normalizeAnswer(body.answer);
    const explanation = safeStr(body.explanation ?? "", 2500);
    const tags = Array.isArray(body.tags) ? body.tags.map((t) => safeStr(t, 40)).filter(Boolean).slice(0, 8) : [];
    const lang = (String(body.language || "ko").toLowerCase() === "en") ? "en" : "ko";

    if (!prompt) return json({ error: "prompt required" }, { status: 400 });

    // JSON Schema for structured output
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["variants"],
      properties: {
        variants: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["prompt", "answer", "explanation"],
            properties: {
              prompt: { type: "string", description: "영문 문장(문제). 1~2문장 이내." },
              answer: { type: "string", enum: ["O", "X"] },
              explanation: { type: "string", description: "짧은 해설(한국어/영어)." }
            }
          }
        }
      }
    };

    const system = lang === "en"
      ? `You are an expert writer of English grammar TRUE/FALSE (O/X) questions.
Generate variant questions that test the SAME grammar point as the original.
Rules:
- Output MUST match the given JSON schema only.
- Create exactly ${n} variants.
- Each variant is 1 sentence (or at most 2 short sentences).
- Do NOT copy the original sentence; change vocabulary and structure while keeping the same grammar point.
- Include both O and X at least once when n >= 2.
- Explanations must be concise (1–2 sentences), written in English.
- Avoid sensitive topics (violence, hate, sexual content, real-person allegations, politics).`
      : `너는 한국어로 해설하는 영어 문법 OX(참/거짓) 문제 출제자야.
원문과 같은 문법 포인트를 테스트하는 변형문제를 만들어.
규칙:
- 출력은 반드시 주어진 JSON 스키마만 따라야 함(다른 텍스트 금지).
- 변형문제는 정확히 ${n}개.
- 각 문제는 1문장(최대 2문장)으로 간결하게.
- 원문 문장을 그대로 베끼지 말고 어휘/구조를 바꿔서 새 문장으로 작성.
- n>=2면 O와 X가 최소 1번씩 포함되게.
- 해설은 한국어로 1~2문장, 규칙/근거만 짧게.
- 폭력/혐오/선정/실존인 비방/정치 선동 등 민감 주제는 피할 것.`;

    const user = {
      original: { prompt, answer, explanation, tags },
      request: {
        count: n,
        goal: "오답 개념을 교정하기 위한 변형 OX 문제",
      }
    };

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const payload = {
      model,
      input: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) }
      ],
      temperature: 0.7,
      text: {
        format: {
          type: "json_schema",
          name: "ox_variants",
          schema,
          strict: true
        }
      }
    };

    let respJson: any;
    try {
      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const txt = await r.text();
      if (!r.ok) {
        return json({ error: `OpenAI error ${r.status}`, detail: txt }, { status: 500 });
      }
      respJson = JSON.parse(txt);
    } catch (e: any) {
      return json({ error: "Failed to call OpenAI", detail: String(e?.message || e) }, { status: 500 });
    }

    const outText = extractOutputText(respJson);
    if (!outText) {
      return json({ error: "No output_text from OpenAI", raw: respJson }, { status: 500 });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(outText);
    } catch (e) {
      // Shouldn't happen with structured output, but keep safe
      return json({ error: "Failed to parse model output as JSON", outText }, { status: 500 });
    }

    // Validate and post-process length
    const variants = Array.isArray(parsed?.variants) ? parsed.variants : [];
    const cleaned = variants
      .map((v: any) => ({
        prompt: safeStr(v?.prompt, 600),
        answer: normalizeAnswer(v?.answer),
        explanation: safeStr(v?.explanation, 800),
      }))
      .filter((v: any) => v.prompt && (v.answer === "O" || v.answer === "X"))
      .slice(0, n);

    // If model returned fewer than requested, still return what we have
    return json({ variants: cleaned, model }, { status: 200 });
  },
};
