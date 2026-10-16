# Codex API

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /codex/v1/responses:
    post:
      summary: Codex API
      deprecated: false
      description: >
        > This endpoint works the same as the GPT model pages; see each model
        page for parameters and responses: [GPT 6
        Astra](/market/chat/gpt-6-astra), [GPT 5.6
        Sol](/market/chat/gpt-5-6-sol), [GPT 5.6
        Terra](/market/chat/gpt-5-6-terra), [GPT 5.6
        Luna](/market/chat/gpt-5-6-luna), [GPT 5.5](/market/chat/gpt-5-5).


        Context window: 272K tokens. The response's model field uses the dotted
        name (e.g. gpt-5.6-sol); both spellings are accepted in requests. List
        the currently available models with GET /openai/v1/models.



        <CardGroup cols={2}>
          <Card title="Multimodal Input" icon="🖼️">
            Supports mixed text, image, and file inputs in a single message.
          </Card>

          <Card title="Reasoning Control" icon="🧠">
            Adjustable reasoning effort from low to max.
          </Card>

          <Card title="Tools & Web Search" icon="✨">
            Integrates web search or custom function calling tools.
          </Card>

          <Card title="Unified Endpoint" icon="💻">
            Uses the unified <code>/codex/v1/responses</code> endpoint with <code>model</code> set to one of <code>gpt-6-astra</code>, <code>gpt-5-6-sol</code>, <code>gpt-5-6-terra</code>, <code>gpt-5-6-luna</code>, <code>gpt-5-5</code>.
          </Card>
        </CardGroup>


        ## Tools & tool\_choice


        The `tools` array enables **web search** or **function calling**
        capabilities.


        :::caution

        Web Search and Function Calling are **mutually exclusive**.  

        In a single request you should choose only one: do not include both
        `{"type": "web_search"}` and `{"type": "function", ...}` in the same
        `tools` array.

        :::



        <AccordionGroup>
          <Accordion title="Web Search">
            Use the built-in Web Search tool to retrieve up-to-date information:

            ```json
            {
              "tools": [
                {
                  "type": "web_search"
                }
              ]
            }
            ```
          </Accordion>

          <Accordion title="Function Calling">
            Define business functions that the model can call when needed:

            ```json
            {
              "tools": [
                {
                  "type": "function",
                  "name": "get_current_weather",
                  "description": "Get the current weather in a given location",
                  "parameters": {
                    "type": "object",
                    "properties": {
                      "location": {
                        "type": "string",
                        "description": "The city and state, e.g. San Francisco, CA"
                      },
                      "unit": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"]
                      }
                    },
                    "required": ["location", "unit"]
                  }
                }
              ],
              "tool_choice": "auto"
            }
            ```

            When function tools are configured in `tools`, set `tool_choice` to `"auto"` so the model can decide when to call them.  
            If you do not configure any function tools, omit the `tool_choice` field.
          </Accordion>
        </AccordionGroup>


        ## Error handling


        Check the response body, not only the HTTP status. Errors are returned
        either as `{"code": ..., "msg": "..."}` (for example 401 invalid API
        key, 402 insufficient credits, 429 rate limited; the HTTP status may
        still be 200) or as `{"error": {"type": "...", "message": "..."}}`.
      operationId: gpt-codex-responses
      tags:
        - docs/en/Market/Chat  Models/Codex
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                model:
                  type: string
                  description: >-
                    Target model name. Allowed values: `gpt-6-astra`,
                    `gpt-5-6-sol`, `gpt-5-6-terra`, `gpt-5-6-luna`, `gpt-5-5`.
                  default: gpt-6-astra
                  enum:
                    - gpt-6-astra
                    - gpt-5-6-sol
                    - gpt-5-6-terra
                    - gpt-5-6-luna
                    - gpt-5-5
                  x-apidog-enum:
                    - value: gpt-6-astra
                      name: ''
                      description: ''
                    - value: gpt-5-6-sol
                      name: ''
                      description: ''
                    - value: gpt-5-6-terra
                      name: ''
                      description: ''
                    - value: gpt-5-6-luna
                      name: ''
                      description: ''
                    - value: gpt-5-5
                      name: ''
                      description: ''
                  examples:
                    - gpt-6-astra
                stream:
                  type: boolean
                  description: >-
                    Defaults to true (Server-Sent Events). Set to false to
                    receive a single JSON response.
                  default: true
                input:
                  oneOf:
                    - type: string
                      description: Input can be a string.
                    - type: array
                      description: >-
                        Input can be an array; each element is a message object
                        with role and content.
                      items:
                        type: object
                        description: A message object with role and content.
                        properties:
                          role:
                            type: string
                            description: Message role, e.g. `user`.
                            examples:
                              - user
                          content:
                            type: array
                            description: >-
                              Content parts: {"type":"input_text","text":"..."},
                              {"type":"input_image","image_url":"<URL or
                              data:image/...;base64,...>"},
                              {"type":"input_file","file_url":"<URL>"}.
                            items:
                              type: object
                              properties: {}
                              x-apidog-orders: []
                              x-apidog-ignore-properties: []
                        x-apidog-orders:
                          - role
                          - content
                        x-apidog-ignore-properties: []
                      minItems: 1
                reasoning:
                  type: object
                  description: Reasoning configuration for the model.
                  properties:
                    effort:
                      type: string
                      description: >-
                        Reasoning effort: low, medium, high, xhigh or max.
                        Defaults to medium. `max` is not available for gpt-5-5.
                      enum:
                        - low
                        - medium
                        - high
                        - xhigh
                        - max
                      default: medium
                      examples:
                        - low
                      x-apidog-enum:
                        - value: low
                          name: ''
                          description: ''
                        - value: medium
                          name: ''
                          description: ''
                        - value: high
                          name: ''
                          description: ''
                        - value: xhigh
                          name: ''
                          description: ''
                        - value: max
                          name: ''
                          description: ''
                  x-apidog-orders:
                    - effort
                  x-apidog-ignore-properties: []
                tools:
                  type: array
                  description: >-
                    Optional tools that the model may call. Either web search OR
                    function calling should be configured, but not both
                    simultaneously.
                  items:
                    oneOf:
                      - $ref: '#/components/schemas/ToolWebSearch'
                      - $ref: '#/components/schemas/ToolFunction'
                tool_choice:
                  type: string
                  description: >-
                    Tool selection behavior. When function tools are configured
                    in `tools`, set this to `auto` so the model can decide when
                    to call them.
                  examples:
                    - auto
                text:
                  type: object
                  description: >-
                    text.format:
                    {"type":"json_schema","name":"...","strict":true,"schema":{...}}
                    makes the output follow your JSON Schema.
                  properties:
                    format:
                      type: object
                      description: Output format definition.
                      properties:
                        type:
                          type: string
                          description: 'Fixed value: json_schema.'
                        name:
                          type: string
                          description: Schema name, used to identify this schema.
                        strict:
                          type: boolean
                          description: >-
                            Whether to enable strict mode. When true, the output
                            must strictly conform to the schema.
                        schema:
                          type: object
                          additionalProperties: true
                          properties: {}
                          x-apidog-orders: []
                          description: >-
                            JSON Schema of the output object, e.g.
                            {"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"],"additionalProperties":false}.
                          x-apidog-ignore-properties: []
                      x-apidog-orders:
                        - type
                        - name
                        - strict
                        - schema
                      required:
                        - type
                        - name
                        - strict
                        - schema
                      x-apidog-ignore-properties: []
                  x-apidog-orders:
                    - format
                  required:
                    - format
                  x-apidog-ignore-properties: []
              required:
                - model
                - input
              x-apidog-orders:
                - model
                - stream
                - input
                - reasoning
                - tools
                - tool_choice
                - text
              x-apidog-ignore-properties: []
            example:
              model: gpt-6-astra
              stream: false
              input:
                - role: user
                  content:
                    - type: input_text
                      text: What is in this image?
                    - type: input_image
                      image_url: >-
                        https://file.aiquickdraw.com/custom-page/akr/section-images/1759055072437dqlsclj2.png
              tools:
                - type: web_search
              reasoning:
                effort: high
      responses:
        '200':
          description: 'Request successful. '
          content:
            text/event-stream:
              schema:
                type: string
                description: >-
                  Streaming responses are sent as Server-Sent Events (SSE) with
                  `Content-Type: text/event-stream`.


                  **Standard output**


                  - **Text delta event**: `event: response.output_text.delta`
                    - `data.delta`: The incremental text content in the stream
                    - `data.type`: Event type, always `response.output_text.delta`
                  - **Completion event**: `event: response.completed`
                    - `data.response.usage`: Token usage information, such as `input_tokens` and `output_tokens`

                  **Function Calling**


                  - **Function call arguments delta event**: `event:
                  response.function_call_arguments.delta`
                    - `data.delta`: Incremental string content of the function call arguments
                    - `data.type`: Event type, always `response.function_call_arguments.delta`
                  - **Completion event**: `event: response.completed`
                    - `data.response.usage`: Token usage information, such as `input_tokens` and `output_tokens`

                  The stream ends with a response.completed event
                  (response.failed or response.incomplete on failure).
              example: |-
                {
                  "output": [
                    {
                      "type": "reasoning",
                      "id": "rs_xxx",
                      "summary": []
                    },
                    {
                      "type": "message",
                      "role": "assistant",
                      "id": "msg_xxx",
                      "content": [
                        {
                          "type": "output_text",
                          "text": "Hello! How can I help you today?"
                        }
                      ],
                      "status": "completed"
                    }
                  ],
                  "usage": {
                    "total_tokens": 4490,
                    "output_tokens": 47,
                    "input_tokens": 4443
                  },
                  "credits_consumed": 0.48,
                  "status": "completed"
                }
          headers: {}
          x-apidog-name: ''
        '400':
          description: Bad Request - Invalid request parameters
          content:
            application/json:
              schema:
                type: object
                properties:
                  error:
                    type: object
                    properties:
                      message:
                        type: string
                        examples:
                          - Invalid request parameters
                      type:
                        type: string
                        examples:
                          - invalid_request_error
                    x-apidog-orders:
                      - message
                      - type
                    x-apidog-ignore-properties: []
                x-apidog-orders:
                  - error
                x-apidog-ignore-properties: []
          headers: {}
          x-apidog-name: ''
        '401':
          description: Unauthorized - Invalid or missing API key
          content:
            application/json:
              schema:
                type: object
                properties:
                  error:
                    type: object
                    properties:
                      message:
                        type: string
                        examples:
                          - Unauthorized
                      type:
                        type: string
                        examples:
                          - authentication_error
                    x-apidog-orders:
                      - message
                      - type
                    x-apidog-ignore-properties: []
                x-apidog-orders:
                  - error
                x-apidog-ignore-properties: []
          headers: {}
          x-apidog-name: ''
        '429':
          description: Rate Limited - Too many requests
          content:
            application/json:
              schema:
                type: object
                properties:
                  error:
                    type: object
                    properties:
                      message:
                        type: string
                        examples:
                          - Rate limit exceeded
                      type:
                        type: string
                        examples:
                          - rate_limit_error
                    x-apidog-orders:
                      - message
                      - type
                    x-apidog-ignore-properties: []
                x-apidog-orders:
                  - error
                x-apidog-ignore-properties: []
          headers: {}
          x-apidog-name: ''
        '500':
          description: Server error.
          content:
            application/json:
              schema:
                type: object
                properties: {}
                x-apidog-orders: []
                x-apidog-ignore-properties: []
          headers: {}
          x-apidog-name: Error
      security:
        - BearerAuth: []
          x-apidog:
            schemeGroups:
              - id: kn8M4YUlc5i0A0179ezwx
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: kn8M4YUlc5i0A0179ezwx
            scopes:
              kn8M4YUlc5i0A0179ezwx:
                BearerAuth: []
      x-apidog-folder: docs/en/Market/Chat  Models/Codex
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-29342626-run
components:
  schemas:
    ToolFunction:
      type: object
      description: Function call tool definition.
      properties:
        type:
          type: string
          enum:
            - function
          examples:
            - function
        name:
          type: string
          description: Function name.
          examples:
            - get_current_weather
        description:
          type: string
          description: A readable description of the function's purpose.
        parameters:
          type: object
          description: JSON Schema describing function parameters.
          x-apidog-orders: []
          properties: {}
          x-apidog-ignore-properties: []
      required:
        - type
        - name
        - description
        - parameters
      x-apidog-orders:
        - type
        - name
        - description
        - parameters
      x-apidog-ignore-properties: []
      x-apidog-folder: ''
    ToolWebSearch:
      type: object
      description: Online search tool configuration.
      properties:
        type:
          type: string
          enum:
            - web_search
          examples:
            - web_search
      required:
        - type
      x-apidog-orders:
        - type
      x-apidog-ignore-properties: []
      x-apidog-folder: ''
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: >-
        All API requests require a Bearer Token. Add the header `Authorization:
        Bearer YOUR_API_KEY` to authenticate requests.
    BearerAuth1:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: >-
        所有 API 请求都需要 Bearer Token。请在请求头中添加 `Authorization: Bearer YOUR_API_KEY`
        进行身份验证。
servers:
  - url: https://api.kie.ai
    description: 正式环境
security:
  - BearerAuth: []
    x-apidog:
      schemeGroups:
        - id: kn8M4YUlc5i0A0179ezwx
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: kn8M4YUlc5i0A0179ezwx
      scopes:
        kn8M4YUlc5i0A0179ezwx:
          BearerAuth: []

```
