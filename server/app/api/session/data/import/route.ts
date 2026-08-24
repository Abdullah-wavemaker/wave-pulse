import { NextResponse } from "next/server";
import { tmpdir } from 'node:os';
import { writeFileSync, readdirSync, readFileSync, unlinkSync, rmSync } from 'node:fs';
import { unzipToDirectory } from "@/wavepulse/zip";

export async function POST(
    request: Request
) {
    const data = (await request.formData() as any);
    const file = data.get('file');
    if (!file) {
        return NextResponse.json({ error: "No files received." }, { status: 400 });
      }
    const zipPath = `${tmpdir()}/wavepulse_${Date.now()}.zip`;
    const outputFilePath = `${tmpdir()}/wavepulse_${Date.now()}`;
    const buffer = Buffer.from(await file.arrayBuffer()) as any;
    writeFileSync(zipPath, buffer);
    try {
        await unzipToDirectory(zipPath, outputFilePath);
        const sessionData = {} as any;
        readdirSync(outputFilePath).forEach(f => {
            sessionData[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(`${outputFilePath}/${f}`, {encoding: "utf-8"}));
        });
        return NextResponse.json(sessionData);
    } finally {
        try { unlinkSync(zipPath); } catch {}
        try { rmSync(outputFilePath, { recursive: true, force: true }); } catch {}
    }
}