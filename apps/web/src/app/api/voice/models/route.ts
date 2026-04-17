import path from "node:path";
import { promises as fs } from "node:fs";
import { NextResponse } from "next/server";
import {
	DEFAULT_VOICE_MODEL_OPTIONS,
	mergeVoiceModelOptions,
} from "@/lib/voice-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOOL_BUILD_ROOT_CANDIDATES = [
	path.resolve(
		process.cwd(),
		"..",
		"..",
		"..",
		"TOOL-BUILD-OWN-API",
		"TOOL BUILD OWN API",
	),
	path.resolve(
		process.cwd(),
		"..",
		"..",
		"TOOL-BUILD-OWN-API",
		"TOOL BUILD OWN API",
	),
];

const MODEL_DIR_SEGMENTS = [["workspace", "models", "voice"]] as const;

async function resolveToolBuildRoot() {
	for (const candidate of TOOL_BUILD_ROOT_CANDIDATES) {
		try {
			const stats = await fs.stat(candidate);
			if (stats.isDirectory()) {
				return candidate;
			}
		} catch {}
	}

	return null;
}

async function collectPthFiles(modelDir: string) {
	const entries = await fs.readdir(modelDir, { withFileTypes: true });
	const models: string[] = [];

	for (const entry of entries) {
		if (!entry.isFile()) {
			continue;
		}
		if (!entry.name.toLowerCase().endsWith(".pth")) {
			continue;
		}
		if (entry.name.toLowerCase().endsWith(".infer.pth")) {
			continue;
		}
		models.push(entry.name);
	}

	return models;
}

export async function GET() {
	try {
		const toolBuildRoot = await resolveToolBuildRoot();
		if (!toolBuildRoot) {
			return NextResponse.json({
				models: [...DEFAULT_VOICE_MODEL_OPTIONS],
			});
		}

		const discoveredModels: string[] = [];

		for (const segments of MODEL_DIR_SEGMENTS) {
			const modelDir = path.join(toolBuildRoot, ...segments);
			try {
				const stats = await fs.stat(modelDir);
				if (!stats.isDirectory()) {
					continue;
				}
				discoveredModels.push(...(await collectPthFiles(modelDir)));
			} catch {}
		}

		return NextResponse.json({
			models: mergeVoiceModelOptions([
				...DEFAULT_VOICE_MODEL_OPTIONS,
				...discoveredModels.sort((left, right) =>
					left.localeCompare(right, undefined, { sensitivity: "base" }),
				),
			]),
		});
	} catch (error) {
		console.error("Failed to list voice models:", error);
		return NextResponse.json(
			{ models: [...DEFAULT_VOICE_MODEL_OPTIONS] },
			{ status: 200 },
		);
	}
}
