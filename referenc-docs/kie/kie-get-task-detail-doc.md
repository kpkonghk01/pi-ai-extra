# Get Task Details

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/jobs/recordInfo:
    get:
      summary: Get Task Details
      deprecated: false
      description: >
        Query the status and results of any task created in the Market models.
        This is a unified query interface that works with all models under the
        Market category.


        ### Supported Models

        Works for every task created via POST /api/v1/jobs/createTask. Chat
        models are synchronous and have no task to query.


        ### Task States

        - **waiting**: Task is queued and waiting to be processed

        - **queuing**: Task is in the processing queue

        - **generating**: Task is currently being processed

        - **success**: Task completed successfully

        - **fail**: Task failed


        ### Best Practices

        - **Use callbacks for production**: Include `callBackUrl` when creating
        tasks to avoid polling

        - **Implement exponential backoff**: Start with 2-3 second intervals,
        increase gradually

        - **Long-running tasks**: Some video tasks take longer than 10 minutes.
        Keep polling until state is success or fail.

        - **Download results**: Generated files are kept for 14 days.


        ### Errors

        Errors are returned with HTTP 200; check `code`. Common values: `401`
        invalid or missing API key; `422` taskId is missing, or the task does
        not exist or does not belong to your account.
      operationId: get-task-details
      tags:
        - docs/en/Market
      parameters:
        - name: taskId
          in: query
          description: The unique task identifier returned when you created the task.
          required: true
          schema:
            type: string
            examples:
              - task_12345678
      responses:
        '200':
          description: Request successful
          content:
            application/json:
              schema:
                allOf:
                  - &ref_0
                    $ref: '#/components/schemas/response%20not%20with%20recordId'
                  - properties:
                      data:
                        description: The task data object containing all task information
                        properties:
                          taskId:
                            description: The unique identifier for this task
                            examples:
                              - task_12345678
                            type: string
                          model:
                            description: >-
                              The model used for this task (e.g.,
                              grok-imagine/text-to-image, seedream-4.0,
                              kling-1.0)
                            examples:
                              - bytedance/seedance-2-5
                              - gpt-image-2-text-to-image
                            type: string
                          state:
                            description: >-
                              Current state of the task. Check state to
                              determine the outcome.
                            enum:
                              - waiting
                              - queuing
                              - generating
                              - success
                              - fail
                            examples:
                              - success
                            type: string
                          param:
                            description: >-
                              JSON string containing the original request
                              parameters used to create the task. Its `input` is
                              itself a JSON string — parse it twice.
                            examples:
                              - >-
                                {"model":"grok-imagine/text-to-image","callBackUrl":"https://your-domain.com/api/callback","input":"{\"prompt\":\"Cinematic
                                portrait...\",\"aspect_ratio\":\"3:2\"}"}
                            type: string
                          resultJson:
                            description: >-
                              Result JSON string. Present when state is success;
                              on failure it may be null or an empty string.


                              The structure is as follows:

                              - For images/media/videos: {resultUrls: []}

                              - If return_last_frame is enabled on Seedance 2.x
                              models: {resultUrls: [], lastFrameUrl: []}

                              - For text output: {resultObject: {}}


                              For OmniHuman series models:

                              - OmniHuman 1.5 Subject Detection (subject
                              detection model): response structure is
                              {resultObject: {mask_urls: ["url1", "url2",
                              ...]}}, returning a list of mask image URLs
                              corresponding to the detected subjects. The URLs
                              returned by this model are valid for 1 hour.

                              - OmniHuman 1.5 Human Identification (human
                              identification model): response structure is
                              {resultObject: {subject_status: 1}}, where
                              `subject_status` means 0 = no subject detected, 1
                              = subject detected, indicating whether a human
                              subject is detected in the image.
                            examples:
                              - >-
                                {"resultUrls":["https://example.com/generated-content.jpg"]}
                              - '{"resultObject":{"subject_status":1}}'
                              - >-
                                {"resultObject":{"mask_urls":["https://example.com/mask_1",
                                "https://example.com/mask_2"]}}
                            type: string
                          response:
                            type: object
                            description: >-
                              Parsed form of resultJson. Present only when state
                              is success.
                            x-apidog-orders: []
                            properties: {}
                            x-apidog-ignore-properties: []
                          failCode:
                            description: >-
                              Failure code (numeric string, e.g. "500"). Present
                              when state is fail; on success it may be null or
                              an empty string.
                            examples:
                              - ''
                            type: string
                          failMsg:
                            description: >-
                              Failure reason. Present when state is fail; on
                              success it may be null or an empty string.
                            examples:
                              - ''
                            type: string
                          costTime:
                            description: >-
                              Processing time in seconds. Present for both
                              successful and failed tasks.
                            examples:
                              - 15
                            format: int64
                            type: integer
                          completeTime:
                            description: >-
                              Completion timestamp (Unix timestamp in
                              milliseconds)
                            examples:
                              - 1698765432000
                            format: int64
                            type: integer
                          createTime:
                            description: >-
                              Creation timestamp (Unix timestamp in
                              milliseconds)
                            examples:
                              - 1698765400000
                            format: int64
                            type: integer
                          creditsConsumed:
                            description: >-
                              Credit consumption details for this task,
                              indicating the actual number of credits deducted
                              during task execution.
                            type: number
                        type: object
                        x-apidog-orders:
                          - taskId
                          - model
                          - state
                          - param
                          - resultJson
                          - response
                          - failCode
                          - failMsg
                          - costTime
                          - completeTime
                          - createTime
                          - creditsConsumed
                        x-apidog-ignore-properties: []
                    type: object
                    x-apidog-orders:
                      - data
                    x-apidog-ignore-properties: []
              example:
                code: 200
                msg: success
                data:
                  taskId: task_12345678
                  model: grok-imagine/text-to-image
                  state: success
                  param: >-
                    {"model":"grok-imagine/text-to-image","callBackUrl":"https://your-domain.com/api/callback","input":"{\"prompt\":\"Cinematic
                    portrait...\",\"aspect_ratio\":\"3:2\"}"}
                  resultJson: '{"resultUrls":["https://example.com/generated-content.jpg"]}'
                  failCode: ''
                  failMsg: ''
                  costTime: 15
                  completeTime: 1698765432000
                  createTime: 1698765400000
                  updateTime: 1698765432000
                  progress: 45
                  creditsConsumed: 50
          headers: {}
          x-apidog-name: ''
        '401':
          description: Unauthorized - Invalid or missing API key
          content:
            application/json:
              schema: *ref_0
              example:
                code: 401
                msg: Unauthorized
          headers: {}
          x-apidog-name: ''
        '422':
          description: Validation error.
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: integer
                  msg:
                    type: string
                  data:
                    type: 'null'
                required:
                  - code
                  - msg
                  - data
                x-apidog-orders:
                  - code
                  - msg
                  - data
                x-apidog-ignore-properties: []
              example:
                code: 422
                msg: recordInfo is null
                data: null
          headers: {}
          x-apidog-name: ''
        '429':
          description: Rate Limited - Too many requests
          content:
            application/json:
              schema: *ref_0
              example:
                code: 429
                msg: Rate limit exceeded
          headers: {}
          x-apidog-name: ''
        '500':
          description: Server error.
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: integer
                    description: >-
                      Response status code


                      - **200**: Success - Request has been processed
                      successfully

                      - **401**: Unauthorized - Authentication credentials are
                      missing or invalid

                      - **402**: Insufficient Credits - Account does not have
                      enough credits to perform the operation

                      - **404**: Not Found - The requested resource or endpoint
                      does not exist

                      - **408**: Timeout - No result has been returned for over
                      10 minutes.

                      - **422**: Validation Error - The request parameters
                      failed validation checks

                      - **429**: Rate Limited - Request limit has been exceeded
                      for this resource

                      - **455**: Service Unavailable - System is currently
                      undergoing maintenance

                      - **500**: Server Error - An unexpected error occurred
                      while processing the request

                      - **501**: Generation Failed - Content generation task
                      failed

                      - **505**: Feature Disabled - The requested feature is
                      currently disabled
                  msg:
                    type: string
                    description: Response message, error description when failed
                  data:
                    type: object
                    properties: {}
                    x-apidog-orders: []
                    x-apidog-ignore-properties: []
                x-apidog-orders:
                  - code
                  - msg
                  - data
                required:
                  - code
                  - msg
                  - data
                x-apidog-ignore-properties: []
              example:
                code: 500
                msg: >-
                  Server Error - An unexpected error occurred while processing
                  the request
                data: null
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
      x-apidog-folder: docs/en/Market
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506351-run
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
