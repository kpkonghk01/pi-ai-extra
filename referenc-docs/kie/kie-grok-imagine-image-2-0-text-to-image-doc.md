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
                        required. Up to 8,000 characters.
                      examples:
                        - >-
                          A small wooden cabin beside a calm lake at sunrise,
                          soft mist over the water
                      maxLength: 8000
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
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: grok-imagine-image-2-0/text-to-image
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: >-
                  A small wooden cabin beside a calm lake at sunrise, soft mist
                  over the water
                aspect_ratio: '1:1'
      responses:
        '200':
          description: Request successful
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/response%20not%20with%20recordId'
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
                        x-apidog-ignore-properties: []
                    x-apidog-orders:
                      - data
                    x-apidog-ignore-properties: []
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
              description: Sent when the task succeeds or fails.
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
                            - 501
                          description: >-
                            200: success. 501: failure; see data.failCode and
                            data.failMsg.
                        msg:
                          type: string
                          description: Status message.
                          example: Playground task completed successfully.
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
                              description: >-
                                Processing time in seconds. Present on both
                                success and failure callbacks.
                            createTime:
                              type: integer
                              format: int64
                              description: >-
                                Task creation time, represented as a Unix
                                timestamp in milliseconds.
                            creditsConsumed:
                              type: number
                              format: double
                              description: >-
                                Credits consumed by the task; 0 for failed
                                tasks.
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
                                `resultUrls` property. Present only when state
                                is success.
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
                                Use completeTime as the completion time;
                                updateTime may equal createTime.
                            failCode:
                              type: string
                              description: >-
                                Failure code, a numeric string such as "400" or
                                "500". Present only when state is fail.
                              example: '500'
                            failMsg:
                              type: string
                              description: Failure reason. Present only when state is fail.
                              example: <error detail>
                    examples:
                      success:
                        summary: Task completed successfully
                        value:
                          code: 200
                          msg: Playground task completed successfully.
                          data:
                            taskId: task_grok_imagine_image_2_0_12345678
                            model: grok-imagine-image-2-0/text-to-image
                            state: success
                            resultJson: >-
                              {"resultUrls":["https://example.com/generated-image-1.jpg"]}
                      failure:
                        summary: Task failed
                        value:
                          code: 501
                          msg: Playground task failed.
                          data:
                            taskId: task_grok_imagine_image_2_0_12345678
                            model: grok-imagine-image-2-0/text-to-image
                            state: fail
                            failCode: '500'
                            failMsg: <error detail>
                            creditsConsumed: 0
              responses:
                '200':
                  description: Callback received successfully
      x-apidog-folder: docs/en/Market/Image    Models/Grok Imagine
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-41730795-run
components:
  schemas:
    response not with recordId:
      type: object
      required:
        - data
      properties:
        code:
          type: integer
          description: >-
            Status code of the request. The HTTP status is 200 even when the
            request fails, so always check this field: 200 means success; any
            other value means the request failed and msg describes the reason.
            Common values: 401 invalid or missing API key; 402 insufficient
            credits; 429 rate limit exceeded; 422 or 500 the request could not
            be processed (read msg and check your parameters before retrying).
          enum:
            - 200
            - 401
            - 402
            - 404
            - 422
            - 429
            - 433
            - 455
            - 500
            - 501
            - 505
        msg:
          type: string
          description: Response message, error description upon failure
          examples:
            - success
        data:
          type: object
          required:
            - taskId
          properties:
            taskId:
              type: string
              description: >-
                The task ID can be used with the "Get Task Details" endpoint to
                query the task status.
              examples:
                - dc1928bfcbc77cb6c85f3359a9c718b3
          x-apidog-orders:
            - taskId
          x-apidog-ignore-properties: []
      x-apidog-orders:
        - code
        - msg
        - data
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
