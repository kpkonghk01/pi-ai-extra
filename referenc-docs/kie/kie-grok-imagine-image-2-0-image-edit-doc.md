# Grok Imagine Image 2.0 Image Edit

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
      summary: Grok Imagine Image 2.0 Image Edit
      deprecated: false
      description: >
        ## Query Task Status


        After submitting a task, use the unified query endpoint to check
        progress and retrieve results:


        <Card title="Get Task Details" icon="lucide-search"
        href="/market/common/get-task-detail">
          Learn how to query task status and retrieve generation results
        </Card>


        ::: tip[]

        For production use, we recommend using the `callBackUrl` parameter to
        receive automatic notifications when generation completes, rather than
        polling the status endpoint.

        :::


        ## Related Resources


        <CardGroup cols={2}>
          <Card title="Market Overview" icon="lucide-store" href="/market/quickstart">
            Explore all available models
          </Card>
          <Card title="Common API" icon="lucide-cog" href="/common-api/get-account-credits">
            Check credits and account usage
          </Card>
        </CardGroup>
      operationId: grok-imagine-image-2-0-image-to-image
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
              properties:
                model:
                  type: string
                  description: >-
                    The model name to use for generation. Required field.


                    - Must be `grok-imagine-image-2-0/image-edit` for this
                    endpoint
                  enum:
                    - grok-imagine-image-2-0/image-edit
                  default: grok-imagine-image-2-0/image-edit
                  examples:
                    - grok-imagine-image-2-0/image-edit
                  x-apidog-enum:
                    - value: grok-imagine-image-2-0/image-edit
                      name: ''
                      description: ''
                callBackUrl:
                  type: string
                  format: uri
                  description: >-
                    The URL to receive generation task completion updates.
                    Optional but recommended for production use.


                    - System will POST task status and results to this URL when
                    generation completes

                    - Callback includes generated content URLs and task
                    information

                    - Your callback endpoint should accept POST requests with
                    JSON payload containing results

                    - Alternatively, use the Get Task Details endpoint to poll
                    task status

                    - To ensure callback security, see [Webhook Verification
                    Guide](/common-api/webhook-verification) for signature
                    verification implementation
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: Input parameters for the generation task
                  properties:
                    prompt:
                      description: >-
                        A text description specifying the desired content or
                        style of the generated image. (Max length: 8000
                        characters)
                      type: string
                      maxLength: 390000
                      examples:
                        - >-
                          Recreate the Titanic movie poster with two adorable
                          anthropomorphic cats in the same romantic pose at the
                          bow of the ship. The male cat is an orange tabby
                          wearing a vest, standing behind a white long-haired
                          female cat in a lace dress, holding her paws as they
                          stretch forward in the wind. Both cats are
                          photorealistic with detailed fur, wind-swept hair, and
                          dramatic sunset lighting (warm golden highlights, cool
                          blue shadows). Background: the Titanic ship at dusk
                          with four smokestacks, glowing deck lights, calm
                          ocean, and orange-pink sunset sky. Center title:
                          “CATANIC” in the same gold metallic serif style as
                          Titanic, same size and position.
                    aspect_ratio:
                      type: string
                      description: >-
                        Specifies the width-to-height ratio of the generated
                        image. Controls the aspect ratio of the output. This
                        field is required.
                      enum:
                        - '1:1'
                        - '2:3'
                        - '3:2'
                        - '16:9'
                        - '9:16'
                        - auto
                      x-apidog-enum:
                        - value: '1:1'
                          name: ''
                          description: ''
                        - value: '2:3'
                          name: ''
                          description: ''
                        - value: '3:2'
                          name: ''
                          description: ''
                        - value: '16:9'
                          name: ''
                          description: ''
                        - value: '9:16'
                          name: ''
                          description: ''
                        - value: auto
                          name: ''
                          description: ''
                    image_urls:
                      type: array
                      items:
                        type: string
                        format: uri
                      description: >-
                        An array containing up to 5 and at least 1 URL strings
                        pointing to a reference image.
                      maxItems: 5
                      examples:
                        - - >-
                            https://static.aiquickdraw.com/tools/example/1767602105243_0MmMCrwq.png
                  required:
                    - aspect_ratio
                    - image_urls
                  x-apidog-orders:
                    - prompt
                    - aspect_ratio
                    - image_urls
                  x-apidog-refs: {}
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: grok-imagine-image-2-0/image-edit
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: >-
                  Recreate the Titanic movie poster with two adorable
                  anthropomorphic cats in the same romantic pose at the bow of
                  the ship. The male cat is an orange tabby wearing a vest,
                  standing behind a white long-haired female cat in a lace
                  dress, holding her paws as they stretch forward in the wind.
                  Both cats are photorealistic with detailed fur, wind-swept
                  hair, and dramatic sunset lighting (warm golden highlights,
                  cool blue shadows). Background: the Titanic ship at dusk with
                  four smokestacks, glowing deck lights, calm ocean, and
                  orange-pink sunset sky. Center title: “CATANIC” in the same
                  gold metallic serif style as Titanic, same size and position.
                aspect_ratio: '1:1'
                image_urls:
                  - >-
                    https://static.aiquickdraw.com/tools/example/1767602105243_0MmMCrwq.png
      responses:
        '200':
          description: Request successful
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/response%20not%20with%20recordId'
              example:
                code: 200
                msg: success
                data:
                  taskId: task_grok-imagine_1767694553297
          headers: {}
          x-apidog-name: ''
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
                          description: >-
                            Status code


                            - **200**: Success - Image generation task completed
                            successfully

                            - **400**: Invalid request parameters or content
                            violates policy

                            - **500**: Internal error. Please try again later.

                            - **501**: Failed - Image generation task failed
                          enum:
                            - 200
                            - 400
                            - 500
                            - 501
                        msg:
                          type: string
                          description: Status message
                          example: Playground task completed successfully.
                        data:
                          type: object
                          properties:
                            completeTime:
                              type: integer
                              format: int64
                              description: >-
                                Task completion time, represented as a Unix
                                timestamp in milliseconds
                              example: 1787284560000
                            costTime:
                              type: integer
                              description: Task duration in seconds
                              example: 35
                            createTime:
                              type: integer
                              format: int64
                              description: >-
                                Task creation time, represented as a Unix
                                timestamp in milliseconds
                              example: 1787284517000
                            creditsConsumed:
                              type: number
                              format: double
                              description: Number of credits consumed by the task
                              example: 4
                            model:
                              type: string
                              description: Image-to-image model used for the task
                              example: grok-imagine-image-2-0/image-edit
                            param:
                              type: string
                              description: >-
                                Parameters submitted when creating the task, in
                                JSON string format
                              example: >-
                                {"input":"{\"aspect_ratio\":\"auto\",\"image_urls\":[\"https://static.aiquickdraw.com/tools/example/1767602105243_0MmMCrwq.png\"],\"prompt\":\"Recreate
                                the Titanic movie poster with two adorable
                                anthropomorphic cats in the same romantic pose
                                at the bow of the ship. The male cat is an
                                orange tabby wearing a vest, standing behind a
                                white long-haired female cat in a lace dress,
                                holding her paws as they stretch forward in the
                                wind. Both cats are photorealistic with detailed
                                fur, wind-swept hair, and dramatic sunset
                                lighting (warm golden highlights, cool blue
                                shadows). Background: the Titanic ship at dusk
                                with four smokestacks, glowing deck lights, calm
                                ocean, and orange-pink sunset sky. Center title:
                                “CATANIC” in the same gold metallic serif style
                                as Titanic, same size and
                                position.\"}","callBackUrl":"http://localhost:8555/api/v1/config/test","model":"grok-imagine-image-2-0/image-edit"}
                            resultJson:
                              type: string
                              description: >-
                                Image generation result in JSON string format.
                                resultUrls contains the list of generated image
                                URLs.
                              example: >-
                                {"resultUrls":["https://tempfile.aiquickdraw.com/ggg/23e972d3-9761-4467-9cc1-29a5aa30b1a6.jpg"]}
                            state:
                              type: string
                              description: Task status
                              enum:
                                - success
                                - fail
                              example: success
                            taskId:
                              type: string
                              description: Task ID
                              example: 6948da647cafec99c49d1dcde91b4b05
                            updateTime:
                              type: integer
                              format: int64
                              description: >-
                                Last task update time, represented as a Unix
                                timestamp in milliseconds
                              example: 1787284560000
              responses:
                '200':
                  description: Callback received successfully
      x-apidog-folder: docs/en/Market/Image    Models/Grok Imagine
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-42143799-run
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
            Response Status Codes


            200: Success - The request was successfully processed.


            401: Unauthorized - Insufficient or invalid authentication
            credentials.


            402: Insufficient Quota - The account has insufficient quota to
            perform this operation.


            404: Not Found - The requested resource or interface does not exist.


            422: Validation Error - The request parameters failed the validation
            check.


            429: Request Restricted - The request frequency limit for this
            resource has been exceeded.


            433: Request Limit - The subkey usage exceeded the limit.


            455: Service Unavailable - The system is currently under
            maintenance.


            500: Server Error - An unexpected error occurred while processing
            the request.


            501: Generation Failed - The content generation task failed.


            505: Feature Disabled - The requested feature is currently disabled.
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
