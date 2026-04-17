import { spawn } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAllowedLocalDraftPath } from "@/lib/local-drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
	folderPath: z.string().min(1),
});

export async function POST(request: NextRequest) {
	try {
		const payload = requestSchema.parse(await request.json());
		if (!isAllowedLocalDraftPath(payload.folderPath)) {
			return NextResponse.json({ error: "Draft path is not allowed" }, { status: 403 });
		}

		spawn("explorer.exe", [payload.folderPath], {
			detached: true,
			windowsHide: true,
			stdio: "ignore",
		}).unref();

		return NextResponse.json({ ok: true });
	} catch (error) {
		console.error("Failed to open local draft folder:", error);
		return NextResponse.json(
			{
				error:
					error instanceof Error
						? error.message
						: "Failed to open local draft folder",
			},
			{ status: 500 },
		);
	}
}
