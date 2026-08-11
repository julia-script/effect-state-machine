import { renderToString } from "react-dom/server"
import { StudioViewer, ViewerClient } from "../../dist/index.js"

export const html = renderToString(<StudioViewer viewerLayer={ViewerClient.layer()} />)
