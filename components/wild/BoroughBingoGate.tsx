"use client";

import dynamic from "next/dynamic";
import { usePassportRead, type PassportBeenRead } from "@/components/profile/PassportData";

const BoroughBingo = dynamic(() => import("./BoroughBingo"), { ssr: false, loading: () => null });

export default function BoroughBingoGate({ handle }: { handle: string }) {
  const been = usePassportRead<PassportBeenRead>("been", handle);
  return been?.access === "full" ? <BoroughBingo been={been.venues} /> : null;
}
