import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = (req: Request) => toNextJsHandler(auth()).GET(req);
export const POST = (req: Request) => toNextJsHandler(auth()).POST(req);
