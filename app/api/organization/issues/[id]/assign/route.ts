import { NextRequest, NextResponse } from "next/server"
import { getAuthUser } from "@/lib/auth-utils"
import { UserModel, IssueModel, CategoryOrganizationMappingModel } from "@/lib/models"
import { db } from "@/lib/db"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Get authenticated user
    const user = await getAuthUser(request)
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const { assignedTo, assignedToName } = await request.json()

    if (!assignedTo || !assignedToName) {
      return NextResponse.json({ error: "Assigned user ID and name are required" }, { status: 400 })
    }

    const issueId = parseInt(id)
    if (isNaN(issueId)) {
      return NextResponse.json({ error: "Invalid issue ID" }, { status: 400 })
    }

    // Check if user is a member of an organization
    const userOrgId = await UserModel.getUserOrganizationId(user.id)
    if (!userOrgId) {
      return NextResponse.json({ error: "User is not a member of any organization" }, { status: 403 })
    }

    // Verify the assignee is also a member of the same organization
    const assigneeOrgId = await UserModel.getUserOrganizationId(parseInt(assignedTo))
    if (!assigneeOrgId || assigneeOrgId !== userOrgId) {
      return NextResponse.json({ error: "Cannot assign to user outside your organization" }, { status: 403 })
    }

    // ...and that the case is actually this department's to assign
    const issue = await IssueModel.findById(issueId)
    if (!issue) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 })
    }
    const ownsCategory = await CategoryOrganizationMappingModel.organizationHandlesCategory(userOrgId, issue.category)
    if (!ownsCategory) {
      return NextResponse.json({ error: "This issue belongs to another department" }, { status: 403 })
    }

    // Update the issue assignment
    await db.query(
      `UPDATE issues SET assigned_to = ?, assigned_to_name = ?, updated_at = NOW() WHERE id = ?`,
      [assignedTo, assignedToName, issueId]
    )

    // Invalidate cache after assignment update
    const { serverCacheInvalidate } = await import('@/lib/server-cache')
    await serverCacheInvalidate(['issues', 'stats', 'analytics'])

    return NextResponse.json({ 
      success: true, 
      message: `Issue assigned to ${assignedToName}`
    })

  } catch (error) {
    console.error("Error assigning issue:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
