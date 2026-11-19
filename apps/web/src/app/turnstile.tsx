import { useEffect, useRef } from "react";

type WidgetId = string | number;
interface TurnstileApi {
  render: (element: HTMLElement, options: {
    sitekey: string; action: string; callback: (token: string) => void;
    "expired-callback": () => void; "error-callback": () => void;
  }) => WidgetId;
  reset: (widgetId: WidgetId) => void;
  remove: (widgetId: WidgetId) => void;
}
type ChallengeWindow = Window & { turnstile?: TurnstileApi };

export function TurnstileVerification({ siteKey, resetVersion, onToken }: {
  siteKey: string; resetVersion: number; onToken: (token: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<WidgetId | null>(null);
  const callback = useRef(onToken);
  callback.current = onToken;

  useEffect(() => {
    let disposed = false;
    const apiWindow = window as ChallengeWindow;
    const render = () => {
      if (disposed || !container.current || !apiWindow.turnstile || widgetId.current !== null) return;
      widgetId.current = apiWindow.turnstile.render(container.current, {
        sitekey: siteKey, action: "alpha_chat",
        callback: (token) => callback.current(token),
        "expired-callback": () => callback.current(""),
        "error-callback": () => callback.current(""),
      });
    };
    let script = document.querySelector<HTMLScriptElement>("script[data-alpha-turnstile]");
    if (apiWindow.turnstile) render();
    else {
      if (!script) {
        script = document.createElement("script");
        script.dataset.alphaTurnstile = "true";
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        document.head.append(script);
      }
      script.addEventListener("load", render);
    }
    return () => {
      disposed = true;
      script?.removeEventListener("load", render);
      if (widgetId.current !== null) apiWindow.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  useEffect(() => {
    if (resetVersion > 0 && widgetId.current !== null) {
      (window as ChallengeWindow).turnstile?.reset(widgetId.current);
    }
  }, [resetVersion]);

  return <div ref={container} aria-label="Проверка срещу автоматизирани заявки" />;
}
