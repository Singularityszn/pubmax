"use client";

import dynamic from "next/dynamic";
import ReadUnavailable from "@/components/ui/read-unavailable";
import { usePassportRead, type PassportBeenRead } from "@/components/profile/PassportData";

const BoroughBingo = dynamic(() => import("./BoroughBingo"), { ssr: false, loading: () => null });

export default function BoroughBingoGate({ handle }: { handle: string }) {
  const read = usePassportRead<PassportBeenRead>("been", handle);
  if (read.status === "unavailable") return <ReadUnavailable subject="your borough bingo" onRetry={read.retry} />;
  const been = read.body;
  return been?.access === "full" ? <BoroughBingo been={been.venues} /> : null;
}
