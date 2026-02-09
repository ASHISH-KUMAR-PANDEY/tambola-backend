/**
 * Metrics Helper
 * Collects and analyzes performance metrics across test scenarios
 */

export interface LatencyMetric {
  timestamp: number;
  latencyMs: number;
  playerId?: string;
}

export class MetricsCollector {
  private latencies: LatencyMetric[] = [];
  private errors: Array<{ timestamp: number; error: string; context?: any }> = [];
  private customMetrics: Map<string, any[]> = new Map();

  recordLatency(latencyMs: number, playerId?: string) {
    this.latencies.push({
      timestamp: Date.now(),
      latencyMs,
      playerId,
    });
  }

  recordError(error: string, context?: any) {
    this.errors.push({
      timestamp: Date.now(),
      error,
      context,
    });
  }

  recordCustom(metricName: string, value: any) {
    if (!this.customMetrics.has(metricName)) {
      this.customMetrics.set(metricName, []);
    }
    this.customMetrics.get(metricName)!.push({
      timestamp: Date.now(),
      value,
    });
  }

  getLatencyStats() {
    if (this.latencies.length === 0) {
      return {
        count: 0,
        min: 0,
        max: 0,
        avg: 0,
        p50: 0,
        p90: 0,
        p99: 0,
      };
    }

    const sorted = [...this.latencies].sort((a, b) => a.latencyMs - b.latencyMs);
    const sum = sorted.reduce((acc, m) => acc + m.latencyMs, 0);

    return {
      count: sorted.length,
      min: sorted[0].latencyMs,
      max: sorted[sorted.length - 1].latencyMs,
      avg: Math.round(sum / sorted.length),
      p50: this.percentile(sorted, 50),
      p90: this.percentile(sorted, 90),
      p99: this.percentile(sorted, 99),
    };
  }

  private percentile(sorted: LatencyMetric[], p: number): number {
    const index = Math.ceil((sorted.length * p) / 100) - 1;
    return sorted[index]?.latencyMs || 0;
  }

  getErrorCount(): number {
    return this.errors.length;
  }

  getErrors() {
    return [...this.errors];
  }

  getCustomMetric(name: string) {
    return this.customMetrics.get(name) || [];
  }

  getAllMetrics() {
    return {
      latency: this.getLatencyStats(),
      errors: this.errors,
      custom: Object.fromEntries(this.customMetrics),
    };
  }

  reset() {
    this.latencies = [];
    this.errors = [];
    this.customMetrics.clear();
  }

  generateReport(): string {
    const latencyStats = this.getLatencyStats();

    let report = '\n╔════════════════════════════════════════════════════════════╗\n';
    report += '║                    METRICS REPORT                          ║\n';
    report += '╚════════════════════════════════════════════════════════════╝\n\n';

    // Latency stats
    report += 'LATENCY STATISTICS:\n';
    report += `  Events recorded: ${latencyStats.count}\n`;
    report += `  Min: ${latencyStats.min}ms\n`;
    report += `  Max: ${latencyStats.max}ms\n`;
    report += `  Avg: ${latencyStats.avg}ms\n`;
    report += `  P50: ${latencyStats.p50}ms\n`;
    report += `  P90: ${latencyStats.p90}ms\n`;
    report += `  P99: ${latencyStats.p99}ms\n\n`;

    // Errors
    report += `ERRORS:\n`;
    report += `  Total errors: ${this.errors.length}\n`;
    if (this.errors.length > 0) {
      report += `  Recent errors:\n`;
      this.errors.slice(-5).forEach((e) => {
        report += `    - ${e.error}\n`;
      });
    }
    report += '\n';

    // Custom metrics
    if (this.customMetrics.size > 0) {
      report += 'CUSTOM METRICS:\n';
      for (const [name, values] of this.customMetrics) {
        report += `  ${name}: ${values.length} data points\n`;
      }
      report += '\n';
    }

    return report;
  }
}

// Singleton instance for global metrics
export const globalMetrics = new MetricsCollector();
