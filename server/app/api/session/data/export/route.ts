import { mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from 'node:os';
import { zipDirectory } from "../../../../../wavepulse/zip";
import { NextResponse } from "next/server";

export async function POST(
    request: Request
) {
    const data = (await request.formData() as any);
    const entries = JSON.parse(data.get('entries')) as string[];
    const fileName = data.get('filename') + '_' + Date.now();
    const path = `${tmpdir()}/${fileName}`;
    const zipName = `${fileName}.zip`;
    const zipPath = `${tmpdir()}/${zipName}`;
    mkdirSync(path, {
        recursive: true
    });
    entries.forEach(e => {
        writeFileSync(`${path}/${e}.json`, data.get(e), 'utf-8');
    });
    try {
        await zipDirectory(path, zipPath);
    } catch(e) {
        console.error(e);
    } finally {
        // Only the zip is needed past this point (served by [filename]/route.ts,
        // which deletes it once fully streamed) - the uncompressed source is not.
        rmSync(path, { recursive: true, force: true });
    }
    return NextResponse.json({
        path: zipName
    });
}