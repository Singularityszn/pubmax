"use client";

import { Component, type ReactNode } from "react";

/** A failed optional presentation must not replace the route's useful stops. */
export default class CrawlPresentationBoundary extends Component<{
  children: ReactNode;
  fallback: ReactNode;
}, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
