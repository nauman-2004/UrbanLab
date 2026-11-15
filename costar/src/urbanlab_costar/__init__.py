"""UrbanLab sponsor-data adapters.

Reusable, provenance-aware building blocks for the UrbanLab research agent:

- ``kit``        : the CoStar data kit (a local, password-protected zip)
- ``vexcel``     : Vexcel API 2.0 client + parsers (parcel, footprint, detections)
- ``matterport`` : models index lookups + Model API (GraphQL) client
- ``research``   : variable catalog, research spec, planner, pipeline
- ``events``     : serializer/validator for the frontend ``StudyEvent`` contract
- ``tools``      : JSON-in/JSON-out functions for the agent backend

Importing this package never reads secrets, opens sockets or touches sponsor
data. Live (authenticated) requests are off by default; see ``config``.
"""

__version__ = "0.1.0"
