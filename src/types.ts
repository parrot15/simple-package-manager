export interface PackageInfo {
  version: string;
  tarballUrl: string;
  hash: string;
  // dependencies: DependencyGraph;
  isDirectDependency: boolean;
  dependencies: string[];
}

export interface DependencyGraph {
  [packageIdentifier: string]: PackageInfo;
}

export interface PackageJson {
  dependencies: Record<string, string>;
}