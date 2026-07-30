import { projectCityEditImpact } from "../core/impactProjection";
import type {
  ImpactProjectionRequest,
  ImpactProjectionWorkerResponse,
} from "../models/impactTypes";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ImpactProjectionRequest>) => void) | null;
  postMessage: (message: ImpactProjectionWorkerResponse) => void;
};

scope.onmessage = (event) => {
  try {
    scope.postMessage({
      requestId: event.data.requestId,
      ok: true,
      impact: projectCityEditImpact(event.data),
    });
  } catch (error) {
    scope.postMessage({
      requestId: event.data.requestId,
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "The economic projection could not be completed.",
    });
  }
};
