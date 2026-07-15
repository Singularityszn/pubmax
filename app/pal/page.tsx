import type { Metadata } from "next";
import PubPalHome from "@/components/pubpal/PubPalHome";
import "./pal.css";

export const metadata: Metadata = { title: "Your Pub Pal", description: "Create and grow your private cyber companion for nights out." };

export default function PalPage() { return <PubPalHome />; }
