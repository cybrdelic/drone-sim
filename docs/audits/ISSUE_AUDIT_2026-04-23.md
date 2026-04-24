# Drone Sim Issue Audit

Audit date: 2026-04-23

This is a static review pass. It mixes confirmed defects, type-safety failures, runtime risks, silent-failure paths, and maintainability issues that are likely to hide bugs.

## Prioritized Findings

1. `src/App.tsx:1105-1108` uses `setWaypoints([...waypoints, e.point])`, so rapid clicks can drop waypoints when updates race on a stale array snapshot.
2. `src/App.tsx:513-517` "Reset" only stops flight and resets telemetry; it does not clear waypoints, so the route survives a reset and the UI is not actually back to a clean state.
3. `src/hooks/useDroneDebugBridge.ts:149-187` can partially apply `viewSettings`, `debugSettings`, `waypoints`, and `isFlyingPath` even when the param/sim patch fails validation, leaving the app in a mixed state.
4. `src/hooks/useDroneDebugBridge.ts:175-181` builds `THREE.Vector3` waypoints from unvalidated payload fields, so malformed bridge messages can inject `NaN` coordinates into the path.
5. `src/hooks/useDroneDebugBridge.ts:198` hardcodes `ws://127.0.0.1:8787`, so the debug bridge silently fails outside that one local setup.
6. `src/hooks/useDroneDebugBridge.ts:223-276` accepts arbitrary JSON commands with no schema validation or authentication, so any local process on that port can mutate sim state.
7. `src/hooks/useDroneDebugBridge.ts:127-154` records patch metadata before validation completes, so rejected patches can still be reported as "applied" by bridge status.
8. `src/hooks/useFlightLog.ts:63-96` timestamps the log by adding a fixed `0.05` seconds on each timer tick, so timer throttling or tab suspension makes replay time inaccurate.
9. `src/hooks/useFlightLog.ts:45-57` stops logging whenever panels and debug overlays are hidden, which turns the "Recorder Window" into a visibility-dependent recorder rather than a real flight recorder.
10. `src/hooks/useFlightLog.ts:67-80` mutates the log array in place with `push`/`splice`, which already caused one stale-chart bug and remains fragile for any memoized consumer.
11. `src/components/FlightDebugInspector.tsx:60-75` uses `logSamples[0]` as the x-axis origin even after slicing to the last 180 samples, so long sessions compress recent traces against an old zero point.
12. `src/components/FlightDebugOverlays.tsx:205-224` mutates `trailRef.current` in `useFrame` but renders directly from the ref, so trail visuals only refresh when some unrelated rerender happens.
13. `src/components/FlightDebugOverlays.tsx:240-244` reads `telemetry.rangefinderM` as if it is guaranteed, and strict nullability already shows that assumption is wrong.
14. `src/components/FlightDebugOverlays.tsx:361-366` feeds `telemetry.rangefinderM` into cone length/radius math without a hard non-null guard, so bad sensor data can poison the overlay.
15. `src/components/WebgpuGridIntegration.tsx:19` attaches `<fog>` to a `<group>`, which does not own a `fog` property, so the showroom fog likely never applies to the scene.
16. `src/components/FlightCameraController.tsx:29-89` overwrites the shared R3F camera every frame and never restores the previous camera state when disabled, so view transitions can inherit stale transforms.
17. `src/components/FlightCameraController.tsx:69` and `src/components/FlightCameraController.tsx:85` allocate fresh `THREE.Vector3` instances every frame in the camera hot path, adding avoidable GC pressure.
18. `src/components/DroneModel.tsx:950-1027` creates a new `AudioContext` every time motor audio is enabled, which can exhaust browser audio-context limits after repeated toggles.
19. `src/components/DroneModel.tsx:996` fills the noise buffer with `Math.random()` on the main thread, making audio nondeterministic and potentially stutter-prone when recreated.
20. `src/components/DroneModel.tsx:1859-1869` swallows Rapier init failures and just keeps the render loop alive, hiding a broken physics state instead of surfacing an actionable error.
21. `src/components/DroneModel.tsx:2084-2103` polls `navigator.getGamepads()` inside the frame loop and silences all errors, so controller failures degrade into unexplained input loss.
22. `src/sim/labModels.ts:229-241` computes `warn` severities in fit checks but throws away everything except `fail`, so borderline assembly problems never reach the user.
23. `src/sim/flightMath.ts:29-76` assumes a valid 4x4 matrix and 4-element RHS but never validates either shape, which is exactly why strict TS finds undefined-index hazards throughout the solver.
24. `vite.config.ts:13-15` still injects `process.env.GEMINI_API_KEY` into the client bundle even though the app no longer uses Gemini, which is stale config at best and accidental secret exposure at worst.
25. `vite.config.ts:45-47` still carries AI Studio/HMR starter behavior and comments, so the dev-server behavior is partly template inheritance rather than an intentional app decision.

## Strict TypeScript Diagnostics

26. `src/App.tsx:1118` TS2322: Type 'Line<BufferGeometry<NormalBufferAttributes, BufferGeometryEventMap>, LineBasicMaterial, Object3DEventMap> | null' is not assignable to type 'object'.
27. `src/components/DroneModel.tsx:19` TS6133: 'tupleFromVector' is declared but its value is never read.
28. `src/components/DroneModel.tsx:23` TS6133: 'CableRun' is declared but its value is never read.
29. `src/components/DroneModel.tsx:35` TS2488: Type '[number, number, number] | undefined' must have a '[Symbol.iterator]()' method that returns an iterator.
30. `src/components/DroneModel.tsx:237` TS6133: 'propMaterial' is declared but its value is never read.
31. `src/components/DroneModel.tsx:250` TS6133: 'fcMaterial' is declared but its value is never read.
32. `src/components/DroneModel.tsx:577` TS2345: Argument of type '[number, number, number]' is not assignable to parameter of type 'never'.
33. `src/components/DroneModel.tsx:773` TS6133: 'centerRadius' is declared but its value is never read.
34. `src/components/DroneModel.tsx:777` TS6133: 'topPlateDepth' is declared but its value is never read.
35. `src/components/DroneModel.tsx:1169` TS2532: Object is possibly 'undefined'.
36. `src/components/DroneModel.tsx:1169` TS2532: Object is possibly 'undefined'.
37. `src/components/DroneModel.tsx:1177` TS2532: Object is possibly 'undefined'.
38. `src/components/DroneModel.tsx:1177` TS2532: Object is possibly 'undefined'.
39. `src/components/DroneModel.tsx:1753` TS2532: Object is possibly 'undefined'.
40. `src/components/DroneModel.tsx:1840` TS6133: 'state' is declared but its value is never read.
41. `src/components/DroneModel.tsx:1842` TS6133: 'drone' is declared but its value is never read.
42. `src/components/DroneModel.tsx:1930` TS2532: Object is possibly 'undefined'.
43. `src/components/DroneModel.tsx:1932` TS2532: Object is possibly 'undefined'.
44. `src/components/DroneModel.tsx:1954` TS6133: 'manualRateDemand01' is declared but its value is never read.
45. `src/components/DroneModel.tsx:1972` TS6133: 'hoverThrottle01' is declared but its value is never read.
46. `src/components/DroneModel.tsx:1988` TS18048: 'wp' is possibly 'undefined'.
47. `src/components/DroneModel.tsx:1989` TS18048: 'wp' is possibly 'undefined'.
48. `src/components/DroneModel.tsx:1990` TS18048: 'wp' is possibly 'undefined'.
49. `src/components/DroneModel.tsx:2256` TS2532: Object is possibly 'undefined'.
50. `src/components/DroneModel.tsx:2293` TS2532: Object is possibly 'undefined'.
51. `src/components/DroneModel.tsx:2293` TS2532: Object is possibly 'undefined'.
52. `src/components/DroneModel.tsx:2293` TS2532: Object is possibly 'undefined'.
53. `src/components/DroneModel.tsx:2293` TS2532: Object is possibly 'undefined'.
54. `src/components/DroneModel.tsx:2294` TS2532: Object is possibly 'undefined'.
55. `src/components/DroneModel.tsx:2294` TS2532: Object is possibly 'undefined'.
56. `src/components/DroneModel.tsx:2294` TS2532: Object is possibly 'undefined'.
57. `src/components/DroneModel.tsx:2294` TS2532: Object is possibly 'undefined'.
58. `src/components/DroneModel.tsx:2296` TS2532: Object is possibly 'undefined'.
59. `src/components/DroneModel.tsx:2297` TS2532: Object is possibly 'undefined'.
60. `src/components/DroneModel.tsx:2298` TS2532: Object is possibly 'undefined'.
61. `src/components/DroneModel.tsx:2299` TS2532: Object is possibly 'undefined'.
62. `src/components/DroneModel.tsx:2308` TS2345: Argument of type 'number | undefined' is not assignable to parameter of type 'number'.
63. `src/components/DroneModel.tsx:2354` TS2532: Object is possibly 'undefined'.
64. `src/components/DroneModel.tsx:2356` TS2345: Argument of type 'number | undefined' is not assignable to parameter of type 'number'.
65. `src/components/DroneModel.tsx:2369` TS2345: Argument of type 'number | undefined' is not assignable to parameter of type 'number'.
66. `src/components/DroneModel.tsx:2379` TS2532: Object is possibly 'undefined'.
67. `src/components/DroneModel.tsx:2381` TS2532: Object is possibly 'undefined'.
68. `src/components/DroneModel.tsx:2397` TS2532: Object is possibly 'undefined'.
69. `src/components/DroneModel.tsx:2449` TS2532: Object is possibly 'undefined'.
70. `src/components/DroneModel.tsx:2463` TS2532: Object is possibly 'undefined'.
71. `src/components/DroneModel.tsx:2481` TS2532: Object is possibly 'undefined'.
72. `src/components/DroneModel.tsx:2482` TS2532: Object is possibly 'undefined'.
73. `src/components/DroneModel.tsx:2485` TS2345: Argument of type 'number | undefined' is not assignable to parameter of type 'number'.
74. `src/components/DroneModel.tsx:2542` TS2532: Object is possibly 'undefined'.
75. `src/components/DroneModel.tsx:2549` TS2345: Argument of type 'Vector3 | undefined' is not assignable to parameter of type 'Vector3Like'.
76. `src/components/DroneModel.tsx:2551` TS2532: Object is possibly 'undefined'.
77. `src/components/DroneModel.tsx:2560` TS2532: Object is possibly 'undefined'.
78. `src/components/DroneModel.tsx:2778` TS2532: Object is possibly 'undefined'.
79. `src/components/DroneModel.tsx:2778` TS2532: Object is possibly 'undefined'.
80. `src/components/DroneModel.tsx:2778` TS2532: Object is possibly 'undefined'.
81. `src/components/DroneModel.tsx:2778` TS2532: Object is possibly 'undefined'.
82. `src/components/DroneModel.tsx:2808` TS2322: Type 'number | undefined' is not assignable to type 'number'.
83. `src/components/DroneModel.tsx:2809` TS2322: Type 'number | undefined' is not assignable to type 'number'.
84. `src/components/DroneModel.tsx:2810` TS2322: Type 'number | undefined' is not assignable to type 'number'.
85. `src/components/DroneModel.tsx:2811` TS2322: Type 'number | undefined' is not assignable to type 'number'.
86. `src/components/DroneModel.tsx:2814` TS2322: Type 'number | undefined' is not assignable to type 'number'.
87. `src/components/DroneModel.tsx:2815` TS2322: Type 'number | undefined' is not assignable to type 'number'.
88. `src/components/DroneModel.tsx:2816` TS2322: Type 'number | undefined' is not assignable to type 'number'.
89. `src/components/DroneModel.tsx:2817` TS2322: Type 'number | undefined' is not assignable to type 'number'.
90. `src/components/DroneModel.tsx:2944` TS2532: Object is possibly 'undefined'.
91. `src/components/DroneModel.tsx:2945` TS2322: Type 'number | undefined' is not assignable to type 'number'.
92. `src/components/DroneModel.tsx:3008` TS2532: Object is possibly 'undefined'.
93. `src/components/DroneModel.tsx:3012` TS2532: Object is possibly 'undefined'.
94. `src/components/DroneModel.tsx:3034` TS6133: 'showTarget' is declared but its value is never read.
95. `src/components/DroneModel.tsx:3223` TS2532: Object is possibly 'undefined'.
96. `src/components/DroneModel.tsx:3223` TS2532: Object is possibly 'undefined'.
97. `src/components/DroneModel.tsx:3228` TS2532: Object is possibly 'undefined'.
98. `src/components/DroneModel.tsx:3228` TS2532: Object is possibly 'undefined'.
99. `src/components/DroneModel.tsx:3402` TS18048: 'dx' is possibly 'undefined'.
100. `src/components/DroneModel.tsx:3403` TS18048: 'dz' is possibly 'undefined'.
101. `src/components/DroneModel.tsx:3858` TS6133: 'color' is declared but its value is never read.
102. `src/components/EngineeringPanel.tsx:149` TS7030: Not all code paths return a value.
103. `src/components/FlightDebugOverlays.tsx:241` TS18048: 'telemetry.rangefinderM' is possibly 'undefined'.
104. `src/components/FlightDebugOverlays.tsx:243` TS18048: 'telemetry.rangefinderM' is possibly 'undefined'.
105. `src/components/FlightDebugOverlays.tsx:361` TS18048: 'telemetry.rangefinderM' is possibly 'undefined'.
106. `src/components/FlightDebugOverlays.tsx:365` TS18048: 'telemetry.rangefinderM' is possibly 'undefined'.
107. `src/components/FlightDebugOverlays.tsx:366` TS18048: 'telemetry.rangefinderM' is possibly 'undefined'.
108. `src/components/RapierDebugLines.tsx:49` TS2322: Type 'number | undefined' is not assignable to type 'number'.
109. `src/components/RapierDebugLines.tsx:50` TS2322: Type 'number | undefined' is not assignable to type 'number'.
110. `src/components/RapierDebugLines.tsx:51` TS2322: Type 'number | undefined' is not assignable to type 'number'.
111. `src/components/Sidebar.tsx:65` TS7030: Not all code paths return a value.
112. `src/hooks/useFlightLog.ts:84` TS2532: Object is possibly 'undefined'.
113. `src/hooks/useFlightLog.ts:84` TS2532: Object is possibly 'undefined'.
114. `src/hooks/useFlightLog.ts:146` TS2532: Object is possibly 'undefined'.
115. `src/sim/flightDamageUx.ts:16` TS6133: 'options' is declared but its value is never read.
116. `src/sim/flightMath.ts:35` TS2532: Object is possibly 'undefined'.
117. `src/sim/flightMath.ts:35` TS2345: Argument of type 'number | undefined' is not assignable to parameter of type 'number'.
118. `src/sim/flightMath.ts:37` TS2532: Object is possibly 'undefined'.
119. `src/sim/flightMath.ts:37` TS2345: Argument of type 'number | undefined' is not assignable to parameter of type 'number'.
120. `src/sim/flightMath.ts:50` TS2322: Type 'number[] | undefined' is not assignable to type 'number[]'.
121. `src/sim/flightMath.ts:51` TS2322: Type 'number[] | undefined' is not assignable to type 'number[]'.
122. `src/sim/flightMath.ts:53` TS2322: Type 'number | undefined' is not assignable to type 'number'.
123. `src/sim/flightMath.ts:54` TS2322: Type 'number | undefined' is not assignable to type 'number'.
124. `src/sim/flightMath.ts:57` TS2532: Object is possibly 'undefined'.
125. `src/sim/flightMath.ts:59` TS2532: Object is possibly 'undefined'.
126. `src/sim/flightMath.ts:59` TS2532: Object is possibly 'undefined'.
127. `src/sim/flightMath.ts:59` TS18048: 'divisor' is possibly 'undefined'.
128. `src/sim/flightMath.ts:61` TS2532: Object is possibly 'undefined'.
129. `src/sim/flightMath.ts:61` TS18048: 'divisor' is possibly 'undefined'.
130. `src/sim/flightMath.ts:68` TS2532: Object is possibly 'undefined'.
131. `src/sim/flightMath.ts:70` TS2532: Object is possibly 'undefined'.
132. `src/sim/flightMath.ts:70` TS2532: Object is possibly 'undefined'.
133. `src/sim/flightMath.ts:70` TS18048: 'factor' is possibly 'undefined'.
134. `src/sim/flightMath.ts:70` TS2532: Object is possibly 'undefined'.
135. `src/sim/flightMath.ts:70` TS2532: Object is possibly 'undefined'.
136. `src/sim/flightMath.ts:72` TS2532: Object is possibly 'undefined'.
137. `src/sim/flightMath.ts:72` TS18048: 'factor' is possibly 'undefined'.
138. `src/sim/flightMath.ts:72` TS2532: Object is possibly 'undefined'.
139. `src/sim/labModels.ts:31` TS6133: 'motorPadRadius' is declared but its value is never read.
140. `src/sim/labModels.ts:363` TS2532: Object is possibly 'undefined'.
141. `src/sim/labModels.ts:364` TS2532: Object is possibly 'undefined'.
142. `src/sim/labModels.ts:368` TS2532: Object is possibly 'undefined'.
143. `src/sim/labModels.ts:369` TS2532: Object is possibly 'undefined'.
144. `src/sim/labModels.ts:372` TS2532: Object is possibly 'undefined'.
145. `src/sim/labModels.ts:375` TS2532: Object is possibly 'undefined'.
146. `src/sim/labModels.ts:376` TS2532: Object is possibly 'undefined'.
147. `src/sim/tuneImport.ts:153` TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
148. `src/sim/tuneImport.ts:154` TS2538: Type 'undefined' cannot be used as an index type.
149. `src/sim/tuneImport.ts:156` TS18048: 'value' is possibly 'undefined'.
150. `vite.config.ts:53` TS7030: Not all code paths return a value.

## Unsafe Any Usage

151. `src/App.tsx:93` Unsafe any usage: `canvas: props.canvas as any`.
152. `src/App.tsx:101` Unsafe any usage: `(renderer as any).setClearColor`.
153. `src/App.tsx:102` Unsafe any usage: `(renderer as any).setClearColor(0x000000, 0)`.
154. `src/App.tsx:111` Unsafe any usage: `const backend = (renderer as any).backend`.
155. `src/App.tsx:116` Unsafe any usage: `return renderer as any`.
156. `src/App.tsx:662` Unsafe any usage: `setPresetId(e.target.value as any)`.
157. `src/App.tsx:1046` Unsafe any usage: `gl={glFactory as any}`.
158. `src/components/Sidebar.tsx:102` Unsafe any usage: `onChange: (value: any) => void`.
159. `src/components/RapierDebugLines.tsx:29` Unsafe any usage: `(world as any).debugRender?.()`.
160. `src/components/DroneModel.tsx:133` Unsafe any usage: `RigidBody: React.ComponentType<any>`.
161. `src/components/DroneModel.tsx:134` Unsafe any usage: `CuboidCollider: React.ComponentType<any>`.
162. `src/components/DroneModel.tsx:194` Unsafe any usage: `const flightBodyRef = useRef<any>(null)`.
163. `src/components/DroneModel.tsx:939` Unsafe any usage: `const anyMat = m as any`.
164. `src/components/DroneModel.tsx:966` Unsafe any usage: `(window as any).webkitAudioContext`.
165. `src/components/DroneModel.tsx:1648` Unsafe any usage: `captureImpactFromCollision(payload: any)`.
166. `src/components/DroneModel.tsx:1670` Unsafe any usage: `captureImpactForce(payload: any)`.
167. `src/components/DroneModel.tsx:4169` Unsafe any usage: `onCollisionEnter={(payload: any) => ...}`.
168. `src/components/DroneModel.tsx:4175` Unsafe any usage: `onContactForce={(payload: any) => ...}`.
169. `src/hooks/useRapierBundle.ts:4` Unsafe any usage: `Physics: any`.
170. `src/hooks/useRapierBundle.ts:5` Unsafe any usage: `RigidBody: any`.
171. `src/hooks/useRapierBundle.ts:6` Unsafe any usage: `CuboidCollider: any`.
172. `src/hooks/useRapierBundle.ts:35` Unsafe any usage: `Physics: (module as any).Physics`.
173. `src/hooks/useRapierBundle.ts:36` Unsafe any usage: `RigidBody: (module as any).RigidBody`.
174. `src/hooks/useRapierBundle.ts:37` Unsafe any usage: `CuboidCollider: (module as any).CuboidCollider`.
175. `src/hooks/useDroneDebugBridge.ts:49` Unsafe any usage: `(currentValue as any)?.constructor?.name`.
176. `src/hooks/useDroneDebugBridge.ts:122` Unsafe any usage: `const applyPatch = (patch: any) =>`.
177. `src/hooks/useDroneDebugBridge.ts:225` Unsafe any usage: `let message: any`.
178. `src/hooks/useDroneDebugBridge.ts:259` Unsafe any usage: `catch (error: any)`.

## Swallowed Or Weak Error Handling

179. `src/App.tsx:251` Swallowed or weak error handling around fullscreen fallback.
180. `src/hooks/useDroneDebugBridge.ts:61` Swallowed or weak error handling in `safeSummary()`.
181. `src/hooks/useDroneDebugBridge.ts:64` Swallowed or weak error handling in `safeSummary()` fallback.
182. `src/hooks/useDroneDebugBridge.ts:199` Swallowed or weak error handling when opening the WebSocket.
183. `src/hooks/useDroneDebugBridge.ts:218` Swallowed or weak error handling when sending the hello message.
184. `src/hooks/useDroneDebugBridge.ts:228` Swallowed or weak error handling when parsing incoming JSON.
185. `src/hooks/useDroneDebugBridge.ts:259` Weak error handling when applying a bridge patch.
186. `src/hooks/useDroneDebugBridge.ts:288` Swallowed or weak error handling when closing the socket on error.
187. `src/hooks/useDroneDebugBridge.ts:300` Swallowed or weak error handling during effect cleanup.
188. `src/sim/tuneImport.ts:134` Swallowed or weak error handling for invalid JSON tune imports.
189. `src/components/DroneModel.tsx:958` Swallowed or weak error handling during audio-node teardown.
190. `src/components/DroneModel.tsx:1022` Swallowed or weak error handling during audio cleanup on unmount.
191. `src/components/DroneModel.tsx:1866` Swallowed or weak error handling during Rapier state initialization.
192. `src/components/DroneModel.tsx:2101` Swallowed or weak error handling during gamepad polling.
193. `src/components/GamepadDiagram.tsx:26` Swallowed or weak error handling when reading controllers.

## Timer, DOM, And Runtime-Risk Sites

194. `src/App.tsx:217` Fullscreen state is read directly from `document.fullscreenElement`, which makes behavior browser-API dependent.
195. `src/App.tsx:224` Global `fullscreenchange` listener adds another browser integration point that can drift from React state.
196. `src/App.tsx:228` Fullscreen listener cleanup is manual, so the logic remains easy to break during future refactors.
197. `src/App.tsx:234` Fullscreen exit path depends on the ambient document state rather than a local state machine.
198. `src/App.tsx:240` Safari-prefixed fullscreen support is handled through an ad-hoc extended type instead of a real wrapper.
199. `src/App.tsx:243` Primary fullscreen request path is browser-API specific and folded into UI code.
200. `src/App.tsx:244` `await target.requestFullscreen()` can reject for gesture-policy reasons and currently falls through to pseudo fullscreen.
201. `src/App.tsx:245` `await target.webkitRequestFullscreen()` is another gesture-sensitive path with no real diagnostics.
202. `src/App.tsx:246` WebKit-prefixed fullscreen handling remains embedded in the component.
203. `src/App.tsx:265` Global `keydown` listener is used to escape pseudo fullscreen instead of scoping the behavior locally.
204. `src/App.tsx:268` Manual document listener cleanup remains another brittle imperative path.
205. `src/App.tsx:373` STL export creates an anchor imperatively instead of using a shared download utility.
206. `src/App.tsx:377` Export appends a DOM node directly to `document.body`.
207. `src/App.tsx:379` Export removes the DOM node manually after clicking it.
208. `src/hooks/useFlightLog.ts:63` Flight logging depends on `setInterval`, which is prone to throttling and tab-suspension drift.
209. `src/hooks/useDroneDebugBridge.ts:198` The bridge uses a raw `new WebSocket("ws://127.0.0.1:8787")` connection.
210. `src/hooks/useDroneDebugBridge.ts:200` Failed bridge connects are retried through `setTimeout`, which is detached from React state.
211. `src/hooks/useDroneDebugBridge.ts:281` Closed sockets schedule another detached reconnect timeout.
212. `src/components/EngineeringPanel.tsx:104` Focus restoration is deferred through `window.setTimeout`, which can fight native focus behavior.
213. `src/components/EngineeringPanel.tsx:151` Slider debounce uses `setTimeout`, which introduces input lag and another async state path.
214. `src/components/DroneModel.tsx:996` The audio noise buffer depends on `Math.random()`, so results are nondeterministic and unseeded.
215. `src/components/DroneModel.tsx:1826` Global `keydown` capture listener is attached at the window level.
216. `src/components/DroneModel.tsx:1827` Global `keyup` capture listener is attached at the window level.
217. `src/components/DroneModel.tsx:1828` Global `blur` listener is attached at the window level.
218. `src/components/DroneModel.tsx:1831` Window-level keydown cleanup is manual and easy to regress.
219. `src/components/DroneModel.tsx:1832` Window-level keyup cleanup is manual and easy to regress.
220. `src/components/DroneModel.tsx:1833` Window-level blur cleanup is manual and easy to regress.
221. `src/components/DroneModel.tsx:2085` The frame loop branches on `navigator.getGamepads`.
222. `src/components/DroneModel.tsx:2086` Controller input depends on per-frame `navigator.getGamepads()` polling.
223. `src/components/GamepadDiagram.tsx:12` The controller inspector reads `navigator.getGamepads` directly.
224. `src/components/GamepadDiagram.tsx:13` The controller inspector snapshots `navigator.getGamepads()` directly.
225. `src/components/GamepadDiagram.tsx:98` The controller inspector uses a 50 ms polling interval.
226. `src/components/Sidebar.tsx:67` Sidebar slider debounce uses `setTimeout`, adding another timer-driven sync path.
