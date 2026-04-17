import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuickLanguage = "km" | "en" | "th";
type DetectedLanguage = QuickLanguage | "zh";

const GOOGLE_TRANSLATE_LANGUAGE_CODES: Record<QuickLanguage, string> = {
	km: "km",
	en: "en",
	th: "th",
};

const translationCache = new Map<string, string>();

function inferLanguage(text: string): DetectedLanguage {
	if (/[\u1780-\u17ff]/.test(text)) {
		return "km";
	}

	if (/[\u0e00-\u0e7f]/.test(text)) {
		return "th";
	}

	if (/[\u4e00-\u9fff]/.test(text)) {
		return "zh";
	}

	return "en";
}

function parseTranslatedText(payload: unknown) {
	if (!Array.isArray(payload) || !Array.isArray(payload[0])) {
		return "";
	}

	return payload[0]
		.map((entry) => {
			if (!Array.isArray(entry)) {
				return "";
			}
			return typeof entry[0] === "string" ? entry[0] : "";
		})
		.join("")
		.trim();
}

async function fetchTranslatedText({
	text,
	targetLanguage,
}: {
	text: string;
	targetLanguage: QuickLanguage;
}) {
	const cacheKey = `${targetLanguage}:${text}`;
	const cached = translationCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const url = new URL("https://translate.googleapis.com/translate_a/single");
	url.searchParams.set("client", "gtx");
	url.searchParams.set("sl", "auto");
	url.searchParams.set(
		"tl",
		GOOGLE_TRANSLATE_LANGUAGE_CODES[targetLanguage],
	);
	url.searchParams.set("dt", "t");
	url.searchParams.set("q", text);

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15000);

	try {
		const response = await fetch(url, {
			headers: {
				Accept: "application/json,text/plain,*/*",
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
			},
			cache: "no-store",
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`Translate request failed with ${response.status}`);
		}

		const translated = parseTranslatedText((await response.json()) as unknown);
		const safeText = translated || text;
		translationCache.set(cacheKey, safeText);
		return safeText;
	} finally {
		clearTimeout(timeout);
	}
}

async function translateTexts({
	texts,
	targetLanguage,
}: {
	texts: string[];
	targetLanguage: QuickLanguage;
}) {
	const translatedTexts = new Array<string>(texts.length);
	const workerCount = Math.min(6, texts.length);
	let nextIndex = 0;

	await Promise.all(
		Array.from({ length: workerCount }, async () => {
			for (;;) {
				const currentIndex = nextIndex;
				nextIndex += 1;
				if (currentIndex >= texts.length) {
					return;
				}

				const text = texts[currentIndex]?.trim() ?? "";
				if (!text) {
					translatedTexts[currentIndex] = "";
					continue;
				}

				translatedTexts[currentIndex] = await fetchTranslatedText({
					text,
					targetLanguage,
				});
			}
		}),
	);

	return translatedTexts;
}

export async function POST(request: Request) {
	try {
		const body = (await request.json()) as {
			texts?: string[];
			targetLanguage?: QuickLanguage;
		};
		const texts = Array.isArray(body.texts) ? body.texts : [];
		const targetLanguage: QuickLanguage =
			body.targetLanguage === "km" ||
			body.targetLanguage === "th" ||
			body.targetLanguage === "en"
				? body.targetLanguage
				: "en";

		if (texts.length === 0) {
			return NextResponse.json(
				{ error: "No transcript text provided for translation." },
				{ status: 400 },
			);
		}

		const combinedText = texts.join(" ").trim();
		const sourceLanguage = inferLanguage(combinedText);

		if (sourceLanguage === targetLanguage) {
			return NextResponse.json({
				texts,
				sourceLanguage,
				targetLanguage,
				identity: true,
			});
		}

		const translatedTexts = await translateTexts({
			texts,
			targetLanguage,
		});

		return NextResponse.json({
			texts: translatedTexts,
			sourceLanguage,
			targetLanguage,
			identity: false,
		});
	} catch (error) {
		console.error("Quick translation failed:", error);
		return NextResponse.json(
			{
				error:
					error instanceof Error ? error.message : "Quick translation failed.",
			},
			{ status: 500 },
		);
	}
}
