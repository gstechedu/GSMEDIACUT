import { NextResponse } from "next/server";
import {
	getWatermarkProgress,
	subscribeWatermarkProgress,
} from "@/lib/watermark/progress-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function encodeEvent(data: unknown) {
	return `data: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const jobId = url.searchParams.get("jobId")?.trim();

	if (!jobId) {
		return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
	}

	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		start(controller) {
			const send = (payload: unknown) => {
				controller.enqueue(encoder.encode(encodeEvent(payload)));
			};

			send({
				type: "ready",
				jobId,
				progress: getWatermarkProgress(jobId),
			});

			const unsubscribe = subscribeWatermarkProgress(jobId, (state) => {
				send({
					type: "progress",
					jobId,
					progress: state,
				});

				if (state.status !== "running") {
					unsubscribe();
					controller.close();
				}
			});

			const keepAlive = setInterval(() => {
				controller.enqueue(encoder.encode(": keep-alive\n\n"));
			}, 15000);

			request.signal.addEventListener("abort", () => {
				clearInterval(keepAlive);
				unsubscribe();
				controller.close();
			});
		},
		cancel() {
			return;
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
		},
	});
}
