# UI Services

Unlike classes, UI services have no common UI base class, and unlike components that
are meant to be re-used, these services present single core UI concept that is used
on a single place and must not be used otherwise. API of the services is often
used by other plugins, modules and parts of the viewer to add and control different menus and UI parts.