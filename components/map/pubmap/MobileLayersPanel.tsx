"use client";

import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type MobileLayersTab = "key" | "layers" | "prices" | "events" | "transit";

/** The phone's More sheet. A tab with no content has no trigger. */
export default function MobileLayersPanel({
  tab,
  onTabChange,
  keyContent,
  layersContent,
  pricesContent,
  eventsContent,
  transitContent,
}: {
  tab: MobileLayersTab;
  onTabChange: (tab: MobileLayersTab) => void;
  keyContent: ReactNode;
  layersContent: ReactNode;
  pricesContent: ReactNode;
  eventsContent: ReactNode;
  transitContent: ReactNode;
}) {
  return (
    <Tabs className="mobileLayersPanel" value={!transitContent && tab === "transit" ? "key" : tab} onValueChange={(value) => onTabChange(value as MobileLayersTab)}>
      <TabsList
        className="mobileMapControlTabs"
        aria-label="Map control sections"
      >
        <TabsTrigger value="key">Key</TabsTrigger>
        <TabsTrigger value="layers">Layers</TabsTrigger>
        {pricesContent ? <TabsTrigger value="prices">Prices</TabsTrigger> : null}
        <TabsTrigger value="events">Events</TabsTrigger>
        {transitContent ? <TabsTrigger value="transit">Transit</TabsTrigger> : null}
      </TabsList>
      <TabsContent value="key" className="mobileLayersPanel">
        {keyContent}
      </TabsContent>
      <TabsContent value="layers" className="mobileLayersPanel">
        {layersContent}
      </TabsContent>
      {pricesContent ? <TabsContent value="prices">{pricesContent}</TabsContent> : null}
      <TabsContent value="events">{eventsContent}</TabsContent>
      {transitContent ? <TabsContent value="transit">{transitContent}</TabsContent> : null}
    </Tabs>
  );
}
