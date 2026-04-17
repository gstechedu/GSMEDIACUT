import { promises as fs } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getLocalDraftCoverFilePath } from "@/lib/local-drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getMimeType(filePath: string) {
	switch (path.extname(filePath).toLowerCase()) {
		case ".png":
			return "image/png";
		case ".jpeg":
		case ".jpg":
		default:
			return "image/jpeg";
	}
}

export async function GET(request: NextRequest) {
	const folderPath = request.nextUrl.searchParams.get("folderPath");
	if (!folderPath) {
		return new NextResponse("Missing folderPath", { status: 400 });
	}

	try {
		const coverPath = await getLocalDraftCoverFilePath(folderPath);
		if (!coverPath) {
			return new NextResponse("Draft cover not found", { status: 404 });
		}

		const fileBuffer = await fs.readFile(coverPath);
		return new NextResponse(new Uint8Array(fileBuffer), {
			status: 200,
			headers: {
				"Content-Type": getMimeType(coverPath),
				"Cache-Control": "private, max-age=60",
			},
		});
	} catch (error) {
		console.error("Failed to read local draft cover:", error);
		return new NextResponse("Failed to read draft cover", { status: 500 });
	}
}
