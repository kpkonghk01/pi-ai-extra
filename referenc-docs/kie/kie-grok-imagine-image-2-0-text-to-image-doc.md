# Grok Imagine Image 2.0 Text To Image

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/jobs/createTask:
    post:
      summary: Grok Imagine Image 2.0 Text To Image
      deprecated: false
      description: >-
        ## Create Task


        Use this endpoint to create a new image generation task with Grok
        Imagine Image 2.0.


        <Card title="Get Task Details" icon="lucide-search"
        href="/market/common/get-task-detail">
          After submitting a task, use the unified task detail endpoint to check progress and retrieve generated images
        </Card>


        ::: tip[]

        For production use, we recommend providing the `callBackUrl` parameter
        so your service can receive task completion notifications instead of
        polling for task status.

        :::


        ## Related Resources


        <CardGroup cols={2}>
          <Card title="Model Market" icon="lucide-store" href="/market/quickstart">
            Browse all available models and capabilities
          </Card>
          <Card title="Common API" icon="lucide-cog" href="/common-api/get-account-credits">
            View account credits and usage
          </Card>
        </CardGroup>
      operationId: grok-imagine-image-2-0-text-to-image
      tags:
        - docs/en/Market/Image    Models/Grok Imagine
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - model
                - input
              properties:
                model:
                  type: string
                  enum:
                    - grok-imagine-image-2-0/text-to-image
                  default: grok-imagine-image-2-0/text-to-image
                  description: >-
                    The model name used for generation. This field is required.
                    This endpoint must use the
                    `grok-imagine-image-2-0/text-to-image` model.
                  examples:
                    - grok-imagine-image-2-0/text-to-image
                callBackUrl:
                  type: string
                  format: uri
                  description: >-
                    Callback URL for task completion notifications. Optional
                    parameter. If provided, the system will send a POST request
                    to this URL when the task completes, whether it succeeds or
                    fails. If omitted, no callback notification will be sent.
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: Input parameters for the image generation task.
                  required:
                    - prompt
                    - aspect_ratio
                  properties:
                    prompt:
                      type: string
                      description: >-
                        Text prompt describing the desired image. This field is
                        required.
                      examples:
                        - ''
                    aspect_ratio:
                      type: string
                      enum:
                        - '1:1'
                        - '2:3'
                        - '3:2'
                        - '16:9'
                        - '9:16'
                      description: >-
                        Specifies the width-to-height ratio of the generated
                        image. Controls the aspect ratio of the output. This
                        field is required.
                      examples:
                        - '1:1'
                  x-apidog-orders:
                    - prompt
                    - aspect_ratio
              x-apidog-orders:
                - model
                - callBackUrl
                - input
            example:
              model: grok-imagine-image-2-0/text-to-image
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: ''
                aspect_ratio: '1:1'
      responses:
        '200':
          description: Request successful
          content:
            application/json:
              schema:
                allOf:
                  - type: object
                    properties: {}
                    x-apidog-orders: []
                  - type: object
                    properties:
                      data:
                        type: object
                        properties:
                          taskId:
                            type: string
                            description: Task ID used to query task status and results.
                        x-apidog-orders:
                          - taskId
                    x-apidog-orders:
                      - data
              example:
                code: 200
                msg: success
                data:
                  taskId: task_grok_imagine_image_2_0_12345678
          headers: {}
          x-apidog-name: ''
      security: []
      callbacks:
        onImageGenerated:
          '{$request.body#/callBackUrl}':
            post:
              summary: Image Generation Callback
              description: >-
                When the image generation task is completed, the system sends
                the result to your callback URL via a POST request.
              requestBody:
                required: true
                content:
                  application/json:
                    schema:
                      type: object
                      properties:
                        code:
                          type: integer
                          enum:
                            - 200
                            - 400
                            - 500
                            - 501
                          description: >-
                            Status code. **200** indicates successful image
                            generation; **400** indicates invalid parameters or
                            a policy violation; **500** indicates an internal
                            error; **501** indicates generation failure.
                        msg:
                          type: string
                          description: Status message.
                          example: Image generation task completed successfully.
                        data:
                          type: object
                          description: Task completion details and generated image results.
                          properties:
                            completeTime:
                              type: integer
                              format: int64
                              description: >-
                                Task completion time, represented as a Unix
                                timestamp in milliseconds.
                            costTime:
                              type: integer
                              description: Task duration in seconds.
                            createTime:
                              type: integer
                              format: int64
                              description: >-
                                Task creation time, represented as a Unix
                                timestamp in milliseconds.
                            creditsConsumed:
                              type: number
                              format: double
                              description: Number of credits consumed by the task.
                            model:
                              type: string
                              description: Image generation model used for the task.
                              example: grok-imagine-image-2-0/text-to-image
                            param:
                              type: string
                              description: >-
                                Parameters submitted when creating the task, in
                                JSON string format.
                            resultJson:
                              type: string
                              description: >-
                                Image generation result in JSON string format.
                                The result URLs are contained in the
                                `resultUrls` property.
                              example: >-
                                {"resultUrls":["https://example.com/generated-image-1.jpg"]}
                            state:
                              type: string
                              enum:
                                - success
                                - fail
                              description: Task status.
                              example: success
                            taskId:
                              type: string
                              description: Task ID.
                              example: task_grok_imagine_image_2_0_12345678
                            updateTime:
                              type: integer
                              format: int64
                              description: >-
                                Last task update time, represented as a Unix
                                timestamp in milliseconds.
              responses:
                '200':
                  description: Callback received successfully
      x-apidog-folder: docs/en/Market/Image    Models/Grok Imagine
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-41730795-run
components:
  schemas: {}
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
